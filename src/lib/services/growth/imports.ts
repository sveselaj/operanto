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
 * Staged CSV import (G2, amended): preview is a pure read that BINDS the
 * import configuration — column mapping and target profile — to the
 * GrowthImport record; commit re-receives the text, verifies the checksum,
 * verifies any client-echoed mapping against the STORED mapping (client
 * fields are untrusted; the stored configuration is what executes), and
 * claims the record atomically (PREVIEWED → COMMITTING) so exactly one
 * concurrent commit can succeed. The raw file is never persisted.
 *
 * Suppression precedence (amended): contact and domain suppression are
 * evaluated INDEPENDENTLY. A suppressed domain always imports its account
 * directly into SUPPRESSED. Contact rules are separate: erasure tombstones
 * are never recreated (the account still imports; the person does not);
 * ordinarily suppressed contacts import pre-marked suppressed.
 */

export type RowDuplicate = {
  rowNumber: number;
  kind: "exact" | "possible" | "in_file";
  reason:
    | "domain_exact"
    | "contact_email_exact"
    | "name_country_match"
    | "name_city_match"
    | "in_file_domain";
  existingAccountId: string | null;
  existingAccountName: string | null;
};

export type RowSuppression = {
  rowNumber: number;
  contactCode?: "contact_erased_tombstone" | "contact_suppressed";
  domainCode?: "domain_suppressed";
};

export type ImportPreview = {
  importId: string;
  checksum: string;
  delimiter: string;
  headers: string[];
  mapping: ColumnMapping;
  targetProfileId: string;
  targetProfileName: string;
  rowCount: number;
  validRows: number[];
  invalidRows: { rowNumber: number; errors: string[] }[];
  duplicates: RowDuplicate[];
  suppressedRows: RowSuppression[];
  sampleRows: { rowNumber: number; values: Partial<MappedRow> }[];
};

function canonicalMapping(mapping: ColumnMapping): string {
  return JSON.stringify(
    Object.keys(mapping)
      .sort()
      .map((key) => [key, mapping[key]]),
  );
}

async function requireActiveProfile(ctx: OrgContext, targetProfileId: string) {
  const profile = await prisma.targetProfile.findFirst({
    where: { ...scope(ctx), id: targetProfileId },
    select: { id: true, name: true, status: true },
  });
  if (!profile) throw new Error("Target profile not found");
  if (profile.status !== "ACTIVE") {
    throw new Error("Imports require an ACTIVE target profile");
  }
  return profile;
}

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

  const duplicates: RowDuplicate[] = [];
  const seenDomains = new Map<string, number>();
  for (const row of validRows) {
    const domain = normalizeDomain(row.domain ?? row.website);
    if (!domain) continue;
    if (seenDomains.has(domain)) {
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
        select: {
          emailNormalized: true,
          accountId: true,
          account: { select: { name: true } },
        },
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
    if (duplicates.some((d) => d.rowNumber === row.rowNumber)) continue;
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

  // Suppression — contact and domain evaluated INDEPENDENTLY.
  const suppressionKeys = [
    ...contactEmails,
    ...domains.map((d) => `domain:${d}`),
  ];
  const suppressions = suppressionKeys.length
    ? await prisma.suppressionEntry.findMany({
        where: {
          organisationId: ctx.organisation.id,
          emailNormalized: { in: suppressionKeys },
        },
        select: { emailNormalized: true, reason: true },
      })
    : [];
  const suppressionMap = new Map(
    suppressions.map((s) => [s.emailNormalized!, s.reason]),
  );
  const suppressedRows: RowSuppression[] = [];
  for (const row of validRows) {
    const email = normalizeEmail(row.contactEmail ?? null);
    const domain = normalizeDomain(row.domain ?? row.website);
    const entry: RowSuppression = { rowNumber: row.rowNumber };
    if (email && suppressionMap.has(email)) {
      entry.contactCode =
        suppressionMap.get(email) === "erasure"
          ? "contact_erased_tombstone"
          : "contact_suppressed";
    }
    if (domain && suppressionMap.has(`domain:${domain}`)) {
      entry.domainCode = "domain_suppressed";
    }
    if (entry.contactCode || entry.domainCode) suppressedRows.push(entry);
  }

  return { parsed, mapping, rows, invalidRows, validRows, duplicates, suppressedRows };
}

export async function previewImport(
  ctx: OrgContext,
  input: {
    filename: string;
    text: string;
    targetProfileId: string;
    mapping?: ColumnMapping;
  },
): Promise<ImportPreview> {
  requirePermission(ctx.membership.role, "growth:import_accounts");
  const profile = await requireActiveProfile(ctx, input.targetProfileId);
  const safeName = input.filename.replace(/[/\\]/g, "_").slice(0, 120);
  const analysis = await analyse(ctx, input.text, input.mapping);
  const checksum = checksumOf(input.text);

  const record = await prisma.growthImport.create({
    data: {
      organisationId: ctx.organisation.id,
      createdByMembershipId: ctx.membership.id,
      targetProfileId: profile.id,
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
      targetProfileId: profile.id,
      rows: analysis.rows.length,
      invalid: analysis.invalidRows.length,
      duplicates: analysis.duplicates.length,
    },
  });

  const flagged = new Set([
    ...analysis.duplicates.map((d) => d.rowNumber),
    ...analysis.suppressedRows.map((s) => s.rowNumber),
  ]);
  return {
    importId: record.id,
    checksum,
    delimiter: analysis.parsed.delimiter,
    headers: analysis.parsed.headers,
    mapping: analysis.mapping,
    targetProfileId: profile.id,
    targetProfileName: profile.name,
    rowCount: analysis.rows.length,
    validRows: analysis.validRows
      .filter((r) => !flagged.has(r.rowNumber))
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

export type CommitInput = {
  importId: string;
  filename: string;
  text: string;
  /** Client echo, verified against the STORED mapping — never executed. */
  mapping?: ColumnMapping;
  resolutions: Record<number, string>;
  acceptPartial: boolean;
};

export type CommitResult = {
  importId: string;
  accepted: number;
  rejected: number;
  skippedDuplicates: number;
  linked: number;
  suppressedImported: number;
  tombstoneSkippedContacts: number;
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
  if (record.status !== "PREVIEWED") {
    throw new Error("Import was already committed or is being committed");
  }
  if (record.checksum !== checksumOf(input.text)) {
    throw new Error("File content changed since preview — preview again");
  }
  const storedMapping = record.columnMapping as ColumnMapping;
  if (
    input.mapping &&
    canonicalMapping(input.mapping) !== canonicalMapping(storedMapping)
  ) {
    throw new Error("Column mapping changed since preview — preview again");
  }
  if (!record.targetProfileId) {
    throw new Error("Import has no bound target profile — preview again");
  }
  // The profile must still be ACTIVE at the moment of commit.
  await requireActiveProfile(ctx, record.targetProfileId);

  // Everything below executes the STORED configuration.
  const analysis = await analyse(ctx, input.text, storedMapping);
  if (analysis.invalidRows.length > 0 && !input.acceptPartial) {
    throw new Error(
      `${analysis.invalidRows.length} invalid rows — confirm partial import explicitly`,
    );
  }

  const duplicateByRow = new Map(analysis.duplicates.map((d) => [d.rowNumber, d]));
  const suppressionByRow = new Map(
    analysis.suppressedRows.map((s) => [s.rowNumber, s]),
  );
  const invalidSet = new Set(analysis.invalidRows.map((r) => r.rowNumber));

  // Server-side resolution validation: every entry must reference a detected
  // duplicate row; link targets must equal the DETECTED candidate exactly.
  type Resolution = "skip" | "new" | { link: string };
  const resolutions = new Map<number, Resolution>();
  for (const [key, value] of Object.entries(input.resolutions ?? {})) {
    const rowNumber = Number(key);
    const duplicate = duplicateByRow.get(rowNumber);
    if (!duplicate) {
      throw new Error(`Resolution supplied for row ${key}, which is not a duplicate`);
    }
    if (value === "new" && duplicate.reason === "domain_exact") {
      throw new Error(
        `Row ${rowNumber}: exact domain duplicate can only be skipped or linked`,
      );
    }
    if (value === "skip" || value === "new") {
      resolutions.set(rowNumber, value);
    } else if (typeof value === "string" && value.startsWith("link:")) {
      const target = value.slice(5);
      if (!duplicate.existingAccountId) {
        throw new Error(`Row ${rowNumber}: no existing candidate to link to`);
      }
      if (target !== duplicate.existingAccountId) {
        throw new Error(
          `Row ${rowNumber}: link target does not match the detected candidate`,
        );
      }
      resolutions.set(rowNumber, { link: target });
    } else {
      throw new Error(`Row ${rowNumber}: invalid resolution value`);
    }
  }

  // Atomic claim — exactly one concurrent commit may pass.
  const claimed = await prisma.growthImport.updateMany({
    where: { id: record.id, status: "PREVIEWED" },
    data: { status: "COMMITTING" },
  });
  if (claimed.count === 0) {
    throw new Error("Import was already committed or is being committed");
  }

  let accepted = 0;
  let skippedDuplicates = 0;
  let linked = 0;
  let suppressedImported = 0;
  let tombstoneSkippedContacts = 0;
  const accountIds: string[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      for (const row of analysis.rows) {
        if (invalidSet.has(row.rowNumber)) continue;
        const suppression = suppressionByRow.get(row.rowNumber);
        const duplicate = duplicateByRow.get(row.rowNumber);
        const resolution: Resolution = duplicate
          ? (resolutions.get(row.rowNumber) ?? "skip")
          : "new";
        if (duplicate && resolution === "skip") {
          skippedDuplicates++;
          continue;
        }
        if (duplicate && typeof resolution === "object") {
          const target = await tx.growthAccount.findFirst({
            where: { organisationId: ctx.organisation.id, id: resolution.link },
            select: { id: true },
          });
          if (!target) throw new Error(`Link target not found for row ${row.rowNumber}`);
          // Provenance only — linking NEVER changes the existing account,
          // including its targetProfileId.
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
          await maybeCreateContact(tx, ctx, target.id, row, suppression);
          if (suppression?.contactCode === "contact_erased_tombstone") {
            tombstoneSkippedContacts++;
          }
          linked++;
          continue;
        }
        if (duplicate?.reason === "domain_exact" && resolution === "new") {
          throw new Error(
            `Row ${row.rowNumber}: exact domain duplicate can only be skipped or linked`,
          );
        }

        const domainNormalized = normalizeDomain(row.domain ?? row.website);
        const domainSuppressed = suppression?.domainCode === "domain_suppressed";
        const complete = Boolean(domainNormalized || row.publicEmail || row.phone);
        const account = await tx.growthAccount.create({
          data: {
            organisationId: ctx.organisation.id,
            targetProfileId: record.targetProfileId,
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
        await maybeCreateContact(tx, ctx, account.id, row, suppression);
        if (suppression?.contactCode === "contact_erased_tombstone") {
          tombstoneSkippedContacts++;
        }
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
          suppressedCount: suppressedImported,
          completedAt: new Date(),
        },
      });
    });
  } catch (error) {
    await prisma.growthImport.update({
      where: { id: record.id },
      data: { status: "FAILED", completedAt: new Date() },
    });
    await audit(ctx, {
      eventType: "growth.import_failed",
      targetType: "GrowthImport",
      targetId: record.id,
      after: { code: "commit_transaction_failed" },
    });
    throw error;
  }

  await audit(ctx, {
    eventType: "growth.import_committed",
    targetType: "GrowthImport",
    targetId: record.id,
    after: {
      targetProfileId: record.targetProfileId,
      accepted,
      rejected: analysis.invalidRows.length,
      skippedDuplicates,
      linked,
      suppressedImported,
      tombstoneSkippedContacts,
    },
  });

  return {
    importId: record.id,
    accepted,
    rejected: analysis.invalidRows.length,
    skippedDuplicates,
    linked,
    suppressedImported,
    tombstoneSkippedContacts,
    accountIds,
  };
}

async function maybeCreateContact(
  tx: Prisma.TransactionClient,
  ctx: OrgContext,
  accountId: string,
  row: MappedRow,
  suppression?: RowSuppression,
) {
  const email = normalizeEmail(row.contactEmail ?? null);
  const hasContact =
    row.contactFirstName || row.contactLastName || email || row.contactPhone;
  if (!hasContact) return;
  // Erased people are never recreated by imports — the account may exist,
  // the person does not return.
  if (suppression?.contactCode === "contact_erased_tombstone") return;
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
        suppressedAt:
          suppression?.contactCode === "contact_suppressed" ? new Date() : null,
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
