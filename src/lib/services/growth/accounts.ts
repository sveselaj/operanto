import "server-only";
import { Prisma, type GrowthAccountStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { normalizeEmail } from "@/lib/normalize";
import { assertTransition } from "@/lib/services/growth/lifecycle";
import {
  normalizeCompanyName,
  normalizeDomain,
} from "@/lib/services/growth/normalize";

/**
 * Growth account foundation (G1). Every status change goes through the
 * transition machine and is audited ids-only; duplicates are detected by
 * constraint (organisation + normalized domain) and surfaced for review —
 * never silently merged. Suppression overrides everything: it is recorded
 * as a SuppressionEntry AND as terminal account state, and future
 * delivery paths (G6, if authorised) must check it at execution time.
 */

export type CreateGrowthAccountInput = {
  name: string;
  domain?: string | null;
  website?: string | null;
  industry?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  employeeEstimate?: number | null;
  description?: string | null;
  phone?: string | null;
  publicEmail?: string | null;
  targetProfileId?: string | null;
  source: { provider: string; providerRecordId?: string | null; sourceUrl?: string | null; importBatchId?: string | null };
};

export type CreateGrowthAccountResult =
  | { created: true; accountId: string }
  | { created: false; duplicateOfAccountId: string };

export async function createGrowthAccount(
  ctx: OrgContext,
  input: CreateGrowthAccountInput,
): Promise<CreateGrowthAccountResult> {
  requirePermission(ctx.membership.role, "growth:import_accounts");
  const name = input.name.trim();
  if (!name) throw new Error("Account name is required");
  const domainNormalized = normalizeDomain(input.domain ?? input.website);

  if (input.targetProfileId) {
    const profile = await prisma.targetProfile.findFirst({
      where: { ...scope(ctx), id: input.targetProfileId },
      select: { id: true },
    });
    if (!profile) throw new Error("Target profile not found");
  }

  try {
    const account = await prisma.growthAccount.create({
      data: {
        organisationId: ctx.organisation.id,
        targetProfileId: input.targetProfileId ?? null,
        name,
        nameNormalized: normalizeCompanyName(name),
        domain: input.domain?.trim() || null,
        domainNormalized,
        website: input.website?.trim() || null,
        industry: input.industry?.trim() || null,
        country: input.country?.trim() || null,
        region: input.region?.trim() || null,
        city: input.city?.trim() || null,
        employeeEstimate: input.employeeEstimate ?? null,
        description: input.description?.trim() || null,
        phone: input.phone?.trim() || null,
        publicEmail: input.publicEmail?.trim() || null,
        sources: {
          create: {
            organisationId: ctx.organisation.id,
            provider: input.source.provider,
            providerRecordId: input.source.providerRecordId ?? null,
            sourceUrl: input.source.sourceUrl ?? null,
            importBatchId: input.source.importBatchId ?? null,
          },
        },
      },
    });
    await audit(ctx, {
      eventType: "growth.account_created",
      targetType: "GrowthAccount",
      targetId: account.id,
      after: { provider: input.source.provider, hasDomain: Boolean(domainNormalized) },
    });
    return { created: true, accountId: account.id };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      domainNormalized
    ) {
      // Constraint-backed duplicate: record provenance against the existing
      // account and surface it for review — never a silent merge.
      const existing = await prisma.growthAccount.findUniqueOrThrow({
        where: {
          organisationId_domainNormalized: {
            organisationId: ctx.organisation.id,
            domainNormalized,
          },
        },
        select: { id: true },
      });
      await prisma.accountSourceRecord.create({
        data: {
          organisationId: ctx.organisation.id,
          accountId: existing.id,
          provider: input.source.provider,
          providerRecordId: input.source.providerRecordId ?? null,
          sourceUrl: input.source.sourceUrl ?? null,
          importBatchId: input.source.importBatchId ?? null,
          duplicateOfAccountId: existing.id,
        },
      });
      await audit(ctx, {
        eventType: "growth.duplicate_detected",
        targetType: "GrowthAccount",
        targetId: existing.id,
        after: { provider: input.source.provider },
      });
      return { created: false, duplicateOfAccountId: existing.id };
    }
    throw error;
  }
}

export async function transitionGrowthAccount(
  ctx: OrgContext,
  accountId: string,
  to: GrowthAccountStatus,
  reason?: string,
): Promise<void> {
  requirePermission(ctx.membership.role, "growth:review_accounts");
  const account = await prisma.growthAccount.findFirst({
    where: { ...scope(ctx), id: accountId },
  });
  if (!account) throw new Error("Account not found");
  assertTransition(account.status, to);
  await prisma.growthAccount.update({
    where: { id: account.id },
    data: {
      status: to,
      ...(to === "SUPPRESSED" ? { suppressedAt: new Date() } : {}),
    },
  });
  await audit(ctx, {
    eventType: "growth.account_status_changed",
    targetType: "GrowthAccount",
    targetId: account.id,
    before: { status: account.status },
    after: { status: to, reason: reason ?? null },
  });
}

/**
 * Suppress an account: terminal state + SuppressionEntry rows for the
 * account domain and every known contact e-mail. Suppression must override
 * all campaign logic, so the entries are what any future delivery path
 * checks — independent of account state.
 */
export async function suppressGrowthAccount(
  ctx: OrgContext,
  accountId: string,
  reason: string,
): Promise<void> {
  requirePermission(ctx.membership.role, "growth:review_accounts");
  const account = await prisma.growthAccount.findFirst({
    where: { ...scope(ctx), id: accountId },
    include: { contacts: true },
  });
  if (!account) throw new Error("Account not found");
  assertTransition(account.status, "SUPPRESSED");

  await prisma.$transaction(async (tx) => {
    await tx.growthAccount.update({
      where: { id: account.id },
      data: { status: "SUPPRESSED", suppressedAt: new Date() },
    });
    const entries = [
      ...(account.domainNormalized
        ? [{ domainNormalized: account.domainNormalized, emailNormalized: null }]
        : []),
      ...account.contacts
        .filter((c) => c.emailNormalized)
        .map((c) => ({ domainNormalized: null, emailNormalized: c.emailNormalized })),
    ];
    for (const entry of entries) {
      await tx.suppressionEntry.upsert({
        where: {
          organisationId_emailNormalized: {
            organisationId: ctx.organisation.id,
            emailNormalized: entry.emailNormalized ?? `domain:${entry.domainNormalized}`,
          },
        },
        update: {},
        create: {
          organisationId: ctx.organisation.id,
          emailNormalized: entry.emailNormalized ?? `domain:${entry.domainNormalized}`,
          domainNormalized: entry.domainNormalized,
          accountId: account.id,
          reason,
          source: "manual",
          createdByMembershipId: ctx.membership.id,
        },
      });
    }
    await tx.growthContact.updateMany({
      where: { accountId: account.id, suppressedAt: null },
      data: { suppressedAt: new Date() },
    });
  });
  await audit(ctx, {
    eventType: "growth.account_suppressed",
    targetType: "GrowthAccount",
    targetId: account.id,
    after: { reason, contacts: account.contacts.length },
  });
}

export function isEmailSuppressed(
  ctx: OrgContext,
  email: string,
): Promise<boolean> {
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) return Promise.resolve(false);
  return prisma.suppressionEntry
    .findFirst({
      where: {
        organisationId: ctx.organisation.id,
        OR: [
          { emailNormalized },
          { domainNormalized: emailNormalized.split("@")[1] ?? "" },
        ],
      },
      select: { id: true },
    })
    .then(Boolean);
}

/**
 * Erasure for prospect personal data (GDPR): PII redacted in place, a
 * minimal suppression record retained so the objection outlives the data,
 * and any drafts addressed to the contact content-redacted. Audit is
 * ids-only, as everywhere.
 */
export async function eraseGrowthContact(
  ctx: OrgContext,
  contactId: string,
  reason: string,
): Promise<void> {
  requirePermission(ctx.membership.role, "growth:manage_privacy");
  const contact = await prisma.growthContact.findFirst({
    where: { ...scope(ctx), id: contactId },
  });
  if (!contact) throw new Error("Contact not found");

  await prisma.$transaction(async (tx) => {
    if (contact.emailNormalized) {
      await tx.suppressionEntry.upsert({
        where: {
          organisationId_emailNormalized: {
            organisationId: ctx.organisation.id,
            emailNormalized: contact.emailNormalized,
          },
        },
        update: {},
        create: {
          organisationId: ctx.organisation.id,
          emailNormalized: contact.emailNormalized,
          accountId: contact.accountId,
          contactId: contact.id,
          reason: "erasure",
          source: "privacy",
          createdByMembershipId: ctx.membership.id,
        },
      });
    }
    await tx.growthContact.update({
      where: { id: contact.id },
      data: {
        firstName: null,
        lastName: null,
        email: null,
        emailNormalized: null,
        phone: null,
        profileUrl: null,
        suppressedAt: contact.suppressedAt ?? new Date(),
        redactedAt: new Date(),
      },
    });
    await tx.outreachDraft.updateMany({
      where: { organisationId: ctx.organisation.id, contactId: contact.id, redactedAt: null },
      data: {
        subject: "(content removed)",
        body: "(content removed)",
        redactedAt: new Date(),
      },
    });
  });
  await audit(ctx, {
    eventType: "growth.contact_erased",
    targetType: "GrowthContact",
    targetId: contact.id,
    after: { reason },
  });
}

export async function listGrowthAccounts(
  ctx: OrgContext,
  filter: { status?: GrowthAccountStatus; targetProfileId?: string } = {},
) {
  requirePermission(ctx.membership.role, "growth:view");
  return prisma.growthAccount.findMany({
    where: {
      ...scope(ctx),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.targetProfileId ? { targetProfileId: filter.targetProfileId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
}
