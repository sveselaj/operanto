import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { normalizeEmail } from "@/lib/normalize";
import {
  applyMapping,
  checksumOf,
  guessMapping,
  parseCsv,
  validateMappedRow,
  type ColumnMapping,
  type MappedRow,
} from "@/lib/services/growth/csv";
import {
  normalizeCompanyName,
  normalizeDomain,
} from "@/lib/services/growth/normalize";

/**
 * Staged CSV import (G2): preview is a pure read (parse → map → validate →
 * duplicate detection, zero writes to domain tables), commit re-receives
 * the same text, re-derives everything deterministically and writes inside
 * one transaction. The raw file is NEVER persisted — the GrowthImport row
 * stores the mapping, checksum, counts and a content-free report (row
 * numbers + codes only), so raw-row retention is structurally moot.
 *
 * Suppression precedence: an erasure tombstone means the contact is NOT
 * recreated by import (policy decision, documented); an ordinary
 * suppression imports the contact already marked suppressed so it is
 * visible but can never become sendable. Suppressed domains import their
 * account directly into SUPPRESSED state — imports never reactivate.
 */

export type RowDuplicate = {
  rowNumber: number;
  kind: "exact" | "possible" | "in_file";
  reason:
    | "domain_exact"
    | "contact_email_exact"
    | "name_country_match"
    | "name_city_match"
    | "in_file_domain"
    | "source_record_exact";
  existingAccountId: string | null;
  existingAccountName: string | null;
};

export type ImportPreview = {
  importId: string;
  checksum: string;
  delimiter: string;
  headers: string[];
  mapping: ColumnMapping;
  rowCount: number;
  validRows: number[];
  invalidRows: { rowNumber: number; errors: string[] }[];
  duplicates: RowDuplicate[];
  suppressedRows: { rowNumber: number; code: "contact_erased_tombstone" | "contact_suppressed" | "domain_suppressed" }[];
  sampleRows: { rowNumber: number; values: Partial<MappedRow> }[];
};

async function analyse(
  ctx: OrgContext,
  text: string,
  mappingOverride?: ColumnMapping,
) {
  const parsed = parseCsv(text);
  const mapping = mappingOverride ?? guessMapping(parsed.headers);
  const rows = applyMapping(parsed, mapping);

  const invalidRows = rows
    .map((row) => ({ rowNumber: row.rowNumber, errors: validateMappedRow(row) }))
    .filter((r) => r.errors.length > 0);
  const invalidSet = new Set(invalidRows.map((r) => r.rowNumber));
  const validRows = rows.filter((r) => !invalidSet.has(r.rowNumber));

  // Duplicate detection — conservative and explainable.
  const duplicates: RowDuplicate[] = [];
  const seenDomains = new Map<string, number>();
  for (const row of validRows) {
    const domain = normalizeDomain(row.domain ?? row.website);
    if (!domain) continue;
    const first = seenDomains.get(domain);
    if (first !== undefined) {
      duplicates.push({
        rowNumber: row.rowNumber,
        kind: "in_file",
        reason: "in_file_domain",
        existingAccountId: null,
        existingAccountName: null,
      });
    } else {
      seenDomains.set(domain, row.rowNumber);
    }
  }
  const domains = [...seenDomains.keys()];
  const existingByDomain = domains.length
    ? await prisma.growthAccount.findMany({
        where: { ...scope(ctx), domainNormalized: { in: domains } },
        select: { id: true, name: true, domainNormalized: true },
      })
    : [];
  const domainToAccount = new Map(
    existingByDomain.map((a) => [a.domainNormalized!, a]),
  );
  const contactEmails = validRows
    .map((r) => normalizeEmail(r.contactEmail ?? null))
    .filter((e): e is string => Boolean(e));
  const existingContacts = contactEmails.length
    ? await prisma.growthContact.findMany({
        where: { ...scope(ctx), emailNormalized: { in: contactEmails } },
        select: { emailNormalized: true, accountId: true, account: { select: { name: true } } },
      })
    : [];
  const emailToAccount = new Map(
    existingContacts.map((c) => [c.emailNormalized!, c]),
  );
  const nameKeys = validRows.map((r) => normalizeCompanyName(r.name ?? ""));
  const candidatesByName = nameKeys.filter(Boolean).length
    ? await prisma.growthAccount.findMany({
        where: { ...scope(ctx), nameNormalized: { in: nameKeys.filter(Boolean) } },
        select: { id: true, name: true, nameNormalized: true, country: true, city: true },
      })
    : [];

  for (const row of validRows) {
    const domain = normalizeDomain(row.domain ?? row.website);
    const inFile = duplicates.some(
      (d) => d.rowNumber === row.rowNumber && d.kind === "in_file",
    );
    if (inFile) continue;
    const domainHit = domain ? domainToAccount.get(domain) : undefined;
    if (domainHit) {
      duplicates.push({
        rowNumber: row.rowNumber,
        kind: "exact",
        reason: "domain_exact",
        existingAccountId: domainHit.id,
        existingAccountName: domainHit.name,
      });
      continue;
    }
    const email = normalizeEmail(row.contactEmail ?? null);
    const emailHit = email ? emailToAccount.get(email) : undefined;
    if (emailHit) {
      duplicates.push({
        rowNumber: row.rowNumber,
        kind: "exact",
        reason: "contact_email_exact",
        existingAccountId: emailHit.accountId,
        existingAccountName: emailHit.account.name,
      });
      continue;
    }
    const nameKey = normalizeCompanyName(row.name ?? "");
    const nameHit = candidatesByName.find((c) => c.nameNormalized === nameKey);
    if (nameHit) {
      const sameCountry =
        row.country && nameHit.country
          ? row.country.trim().toUpperCase() === nameHit.country.toUpperCase()
          : false;
      const sameCity =
        row.city && nameHit.city
          ? row.city.trim().toLowerCase() === nameHit.city.toLowerCase()
          : false;
      if (sameCountry || sameCity) {
        duplicates.push({
          rowNumber: row.rowNumber,
          kind: "possible",
          reason: sameCountry ? "name_country_match" : "name_city_match",
          existingAccountId: nameHit.id,
          existingAccountName: nameHit.name,
        });
      }
    }
  }

  // Suppression checks — the invariant holds before any send path exists.
  const suppressedRows: ImportPreview["suppressedRows"] = [];
  const suppressionKeys = [
    ...contactEmails,
    ...domains.map((d) => `domain:${d}`),
  ];
  const suppressions = suppressionKeys.length
    ? await prisma.suppressionEntry.findMany({
        where: { organisationId: ctx.organisation.id, emailNormalized: { in: suppressionKeys } },
        select: { emailNormalized: true, reason: true },
      })
    : [];
  const suppressionMap = new Map(suppressions.map((s) => [s.emailNormalized!, s.reason]));
  for (const row of validRows) {
    const email = normalizeEmail(row.contactEmail ?? null);
    const domain = normalizeDomain(row.domain ?? row.website);
    if (email && suppressionMap.has(email)) {
      suppressedRows.push({
        rowNumber: row.rowNumber,
        code:
          suppressionMap.get(email) === "erasure"
            ? "contact_erased_tombstone"
            : "contact_suppressed",
      });
    } else if (domain && suppressionMap.has(`domain:${domain}`)) {
      suppressedRows.push({ rowNumber: row.rowNumber, code: "domain_suppressed" });
    }
  }

  return { parsed, mapping, rows, invalidRows, validRows, duplicates, suppressedRows };
}

export async function previewImport(
  ctx: OrgContext,
  input: { filename: string; text: string; mapping?: ColumnMapping },
): Promise<ImportPreview> {
  requirePermission(ctx.membership.role, "growth:import_accounts");
  const safeName = input.filename.replace(/[/\\]/g, "_").slice(0, 120);
  const analysis = await analyse(ctx, input.text, input.mapping);
  const checksum = checksumOf(input.text);

  const record = await prisma.growthImport.create({
    data: {
      organisationId: ctx.organisation.id,
      createdByMembershipId: ctx.membership.id,
      filename: safeName,
      checksum,
      delimiter: analysis.parsed.delimiter,
      columnMapping: analysis.mapping,
      status: "PREVIEWED",
      rowCount: analysis.rows.length,
      rejectedCount: analysis.invalidRows.length,
      duplicateCount: analysis.duplicates.length,
      suppressedCount: analysis.suppressedRows.length,
      report: {
        invalid: analysis.invalidRows,
        duplicates: analysis.duplicates.map((d) => ({
          rowNumber: d.rowNumber,
          kind: d.kind,
          reason: d.reason,
        })),
        suppressed: analysis.suppressedRows,
      } as Prisma.InputJsonValue,
    },
  });
  await audit(ctx, {
    eventType: "growth.import_previewed",
    targetType: "GrowthImport",
    targetId: record.id,
    after: {
      rows: analysis.rows.length,
      invalid: analysis.invalidRows.length,
      duplicates: analysis.duplicates.length,
    },
  });

  return {
    importId: record.id,
    checksum,
    delimiter: analysis.parsed.delimiter,
    headers: analysis.parsed.headers,
    mapping: analysis.mapping,
    rowCount: analysis.rows.length,
    validRows: analysis.validRows
      .filter(
        (r) =>
          !analysis.duplicates.some((d) => d.rowNumber === r.rowNumber) &&
          !analysis.suppressedRows.some((s) => s.rowNumber === r.rowNumber),
      )
      .map((r) => r.rowNumber),
    invalidRows: analysis.invalidRows,
    duplicates: analysis.duplicates,
    suppressedRows: analysis.suppressedRows,
    sampleRows: analysis.rows.slice(0, 5).map((row) => {
      const { rowNumber, ...values } = row;
      return { rowNumber, values };
    }),
  };
}

export type DuplicateResolution = "skip" | "new" | `link:${string}`;

export type CommitInput = {
  importId: string;
  filename: string;
  text: string;
  mapping: ColumnMapping;
  /** Row number → resolution for every duplicate row. Unresolved → skip. */
  resolutions: Record<number, DuplicateResolution>;
  /** Required when invalid rows exist — partial import is explicit. */
  acceptPartial: boolean;
};

export type CommitResult = {
  importId: string;
  accepted: number;
  rejected: number;
  skippedDuplicates: number;
  linked: number;
  suppressedImported: number;
  tombstoneSkipped: number;
  accountIds: string[];
};

export async function commitImport(
  ctx: OrgContext,
  input: CommitInput,
): Promise<CommitResult> {
  requirePermission(ctx.membership.role, "growth:import_accounts");
  const record = await prisma.growthImport.findFirst({
    where: { ...scope(ctx), id: input.importId },
  });
  if (!record) throw new Error("Import not found");
  if (record.status !== "PREVIEWED") throw new Error("Import was already committed");
  if (record.checksum !== checksumOf(input.text)) {
    throw new Error("File content changed since preview — preview again");
  }

  const analysis = await analyse(ctx, input.text, input.mapping);
  if (analysis.invalidRows.length > 0 && !input.acceptPartial) {
    throw new Error(
      `${analysis.invalidRows.length} invalid rows — confirm partial import explicitly`,
    );
  }

  const duplicateByRow = new Map(analysis.duplicates.map((d) => [d.rowNumber, d]));
  const suppressedByRow = new Map(
    analysis.suppressedRows.map((s) => [s.rowNumber, s]),
  );
  const invalidSet = new Set(analysis.invalidRows.map((r) => r.rowNumber));

  let accepted = 0;
  let skippedDuplicates = 0;
  let linked = 0;
  let suppressedImported = 0;
  let tombstoneSkipped = 0;
  const accountIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const row of analysis.rows) {
      if (invalidSet.has(row.rowNumber)) continue;
      const suppression = suppressedByRow.get(row.rowNumber);
      if (suppression?.code === "contact_erased_tombstone") {
        // Policy: erased people are not silently recreated by imports.
        tombstoneSkipped++;
        continue;
      }
      const duplicate = duplicateByRow.get(row.rowNumber);
      const resolution: DuplicateResolution = duplicate
        ? (input.resolutions[row.rowNumber] ?? "skip")
        : "new";
      if (duplicate && resolution === "skip") {
        skippedDuplicates++;
        continue;
      }
      if (duplicate && resolution.startsWith("link:")) {
        const targetId = resolution.slice(5);
        const target = await tx.growthAccount.findFirst({
          where: { organisationId: ctx.organisation.id, id: targetId },
          select: { id: true },
        });
        if (!target) throw new Error(`Link target not found for row ${row.rowNumber}`);
        // Provenance only — linking NEVER overwrites existing values.
        await tx.accountSourceRecord.create({
          data: {
            organisationId: ctx.organisation.id,
            accountId: target.id,
            provider: "csv_import",
            providerRecordId: `${record.id}:${row.rowNumber}`,
            sourceUrl: row.sourceUrl ?? null,
            importBatchId: record.id,
            duplicateOfAccountId: target.id,
          },
        });
        await maybeCreateContact(tx, ctx, target.id, row, suppression?.code);
        linked++;
        continue;
      }
      if (duplicate?.reason === "domain_exact" && resolution === "new") {
        // The unique constraint makes "import as new" impossible for exact
        // domain duplicates — surface it rather than let the tx explode.
        throw new Error(
          `Row ${row.rowNumber}: exact domain duplicate can only be skipped or linked`,
        );
      }

      const domainNormalized = normalizeDomain(row.domain ?? row.website);
      const domainSuppressed = suppression?.code === "domain_suppressed";
      const complete = Boolean(domainNormalized || row.publicEmail || row.phone);
      const account = await tx.growthAccount.create({
        data: {
          organisationId: ctx.organisation.id,
          targetProfileId: record ? undefined : undefined,
          name: row.name!.trim(),
          nameNormalized: normalizeCompanyName(row.name!),
          tradingName: row.tradingName?.trim() || null,
          domain: row.domain?.trim() || null,
          domainNormalized,
          website: row.website?.trim() || null,
          industry: row.industry?.trim() || null,
          description: row.description?.trim() || null,
          country: row.country?.trim().toUpperCase() || null,
          region: row.region?.trim() || null,
          city: row.city?.trim() || null,
          employeeEstimate: row.employeeEstimate
            ? Number(row.employeeEstimate)
            : null,
          phone: row.phone?.trim() || null,
          publicEmail: row.publicEmail?.trim() || null,
          status: domainSuppressed
            ? "SUPPRESSED"
            : complete
              ? "NEEDS_REVIEW"
              : "IMPORTED",
          suppressedAt: domainSuppressed ? new Date() : null,
          sources: {
            create: {
              organisationId: ctx.organisation.id,
              provider: "csv_import",
              providerRecordId: `${record.id}:${row.rowNumber}`,
              sourceUrl: row.sourceUrl ?? null,
              importBatchId: record.id,
            },
          },
        },
      });
      await maybeCreateContact(tx, ctx, account.id, row, suppression?.code);
      if (suppression) suppressedImported++;
      accepted++;
      accountIds.push(account.id);
    }

    await tx.growthImport.update({
      where: { id: record.id },
      data: {
        status: "COMMITTED",
        acceptedCount: accepted,
        rejectedCount: analysis.invalidRows.length,
        duplicateCount: analysis.duplicates.length,
        suppressedCount: suppressedImported + tombstoneSkipped,
        completedAt: new Date(),
      },
    });
  });

  await audit(ctx, {
    eventType: "growth.import_committed",
    targetType: "GrowthImport",
    targetId: record.id,
    after: {
      accepted,
      rejected: analysis.invalidRows.length,
      skippedDuplicates,
      linked,
      suppressedImported,
      tombstoneSkipped,
    },
  });

  return {
    importId: record.id,
    accepted,
    rejected: analysis.invalidRows.length,
    skippedDuplicates,
    linked,
    suppressedImported,
    tombstoneSkipped,
    accountIds,
  };
}

async function maybeCreateContact(
  tx: Prisma.TransactionClient,
  ctx: OrgContext,
  accountId: string,
  row: MappedRow,
  suppressionCode?: string,
) {
  const email = normalizeEmail(row.contactEmail ?? null);
  const hasContact =
    row.contactFirstName || row.contactLastName || email || row.contactPhone;
  if (!hasContact) return;
  if (suppressionCode === "contact_erased_tombstone") return;
  try {
    await tx.growthContact.create({
      data: {
        organisationId: ctx.organisation.id,
        accountId,
        firstName: row.contactFirstName?.trim() || null,
        lastName: row.contactLastName?.trim() || null,
        role: row.contactRole?.trim() || null,
        department: row.contactDepartment?.trim() || null,
        email: row.contactEmail?.trim() || null,
        emailNormalized: email,
        phone: row.contactPhone?.trim() || null,
        language: row.contactLanguage?.trim() || null,
        profileUrl: row.contactProfileUrl?.trim() || null,
        source: "csv_import",
        // Imports never create sendability; a suppressed identity arrives
        // pre-marked and can never be silently reactivated.
        suppressedAt:
          suppressionCode === "contact_suppressed" ? new Date() : null,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return; // Same contact already on this account — never overwrite.
    }
    throw error;
  }
}

export async function listImports(ctx: OrgContext) {
  requirePermission(ctx.membership.role, "growth:view");
  return prisma.growthImport.findMany({
    where: scope(ctx),
    orderBy: { createdAt: "desc" },
    take: 25,
  });
}
