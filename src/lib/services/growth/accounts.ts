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
  await prisma.activity.create({
    data: {
      organisationId: ctx.organisation.id,
      growthAccountId: account.id,
      actorType: "STAFF",
      actorMembershipId: ctx.membership.id,
      activityType: "growth.account_status_changed",
      summary: `Account moved to ${to.toLowerCase().replace(/_/g, " ")}`,
    },
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
  await prisma.activity.create({
    data: {
      organisationId: ctx.organisation.id,
      growthAccountId: account.id,
      actorType: "STAFF",
      actorMembershipId: ctx.membership.id,
      activityType: "growth.account_suppressed",
      summary: "Account suppressed — excluded from all future Growth execution",
    },
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

const EDITABLE_FIELDS = [
  "name",
  "tradingName",
  "domain",
  "website",
  "industry",
  "description",
  "country",
  "region",
  "city",
  "employeeEstimate",
  "phone",
  "publicEmail",
  "targetProfileId",
] as const;
export type EditableAccountField = (typeof EDITABLE_FIELDS)[number];

/**
 * Deterministic account editing. Recomputes normalized keys when identity
 * fields change; a domain edit can neither collide with another account
 * (constraint) nor bypass an existing domain suppression (re-checked and
 * re-applied). Audit records changed field NAMES only.
 */
export async function updateGrowthAccount(
  ctx: OrgContext,
  accountId: string,
  input: Partial<Record<EditableAccountField, string | number | null>>,
): Promise<void> {
  requirePermission(ctx.membership.role, "growth:edit_accounts");
  const account = await prisma.growthAccount.findFirst({
    where: { ...scope(ctx), id: accountId },
  });
  if (!account) throw new Error("Account not found");

  const data: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in input)) continue;
    const raw = input[field];
    const value = typeof raw === "string" ? raw.trim() || null : (raw ?? null);
    data[field] = value;
  }
  if ("name" in data) {
    if (!data.name) throw new Error("Account name is required");
    data.nameNormalized = normalizeCompanyName(String(data.name));
  }
  if ("employeeEstimate" in data && data.employeeEstimate !== null) {
    const estimate = Number(data.employeeEstimate);
    if (!Number.isInteger(estimate) || estimate < 0) {
      throw new Error("Employee estimate must be a whole number");
    }
    data.employeeEstimate = estimate;
  }
  if ("country" in data && data.country) {
    data.country = String(data.country).toUpperCase();
  }
  if ("targetProfileId" in data && data.targetProfileId) {
    const profile = await prisma.targetProfile.findFirst({
      where: { ...scope(ctx), id: String(data.targetProfileId) },
      select: { id: true },
    });
    if (!profile) throw new Error("Target profile not found");
  }
  if ("domain" in data || "website" in data) {
    const domainNormalized = normalizeDomain(
      String(data.domain ?? account.domain ?? data.website ?? account.website ?? "") || null,
    );
    data.domainNormalized = domainNormalized;
    if (domainNormalized) {
      const suppressed = await prisma.suppressionEntry.findFirst({
        where: {
          organisationId: ctx.organisation.id,
          emailNormalized: `domain:${domainNormalized}`,
        },
        select: { id: true },
      });
      if (suppressed && !account.suppressedAt) {
        // An edit must not steer an account out from under a suppression.
        data.suppressedAt = new Date();
        data.status = "SUPPRESSED";
      }
    }
  }
  const changedFields = Object.keys(data).filter(
    (key) =>
      JSON.stringify(data[key]) !==
      JSON.stringify(account[key as keyof typeof account]),
  );
  if (changedFields.length === 0) return;
  try {
    await prisma.growthAccount.update({ where: { id: account.id }, data });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new Error("Another account already uses this domain");
    }
    throw error;
  }
  await audit(ctx, {
    eventType: "growth.account_updated",
    targetType: "GrowthAccount",
    targetId: account.id,
    after: { changedFields },
  });
}

export async function assignGrowthAccount(
  ctx: OrgContext,
  accountId: string,
  membershipId: string | null,
): Promise<void> {
  requirePermission(ctx.membership.role, "growth:assign_accounts");
  const account = await prisma.growthAccount.findFirst({
    where: { ...scope(ctx), id: accountId },
  });
  if (!account) throw new Error("Account not found");
  if (membershipId) {
    const membership = await prisma.membership.findFirst({
      where: {
        id: membershipId,
        organisationId: ctx.organisation.id,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!membership) throw new Error("Assignee must be an active member of this organisation");
  }
  await prisma.growthAccount.update({
    where: { id: account.id },
    data: { ownerMembershipId: membershipId },
  });
  await audit(ctx, {
    eventType: "growth.account_assigned",
    targetType: "GrowthAccount",
    targetId: account.id,
    before: { ownerMembershipId: account.ownerMembershipId },
    after: { ownerMembershipId: membershipId },
  });
  await prisma.activity.create({
    data: {
      organisationId: ctx.organisation.id,
      growthAccountId: account.id,
      actorType: "STAFF",
      actorMembershipId: ctx.membership.id,
      activityType: "growth.account_assigned",
      summary: membershipId ? "Account owner assigned" : "Account owner removed",
    },
  });
}

export async function getGrowthAccount(ctx: OrgContext, accountId: string) {
  requirePermission(ctx.membership.role, "growth:view");
  return prisma.growthAccount.findFirst({
    where: { ...scope(ctx), id: accountId },
    include: {
      targetProfile: { select: { id: true, name: true } },
      contacts: { orderBy: { createdAt: "asc" } },
      sources: { orderBy: { importedAt: "desc" }, take: 20 },
      activities: { orderBy: { occurredAt: "desc" }, take: 30 },
      tasks: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
}

export type AccountListFilter = {
  status?: GrowthAccountStatus;
  targetProfileId?: string;
  country?: string;
  industry?: string;
  ownerMembershipId?: string;
  importBatchId?: string;
  duplicatesOnly?: boolean;
  search?: string;
  page?: number;
};

export async function listGrowthAccountsPage(
  ctx: OrgContext,
  filter: AccountListFilter = {},
) {
  requirePermission(ctx.membership.role, "growth:view");
  const take = 25;
  const page = Math.max(1, filter.page ?? 1);
  const where: Prisma.GrowthAccountWhereInput = {
    ...scope(ctx),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.targetProfileId ? { targetProfileId: filter.targetProfileId } : {}),
    ...(filter.country ? { country: filter.country.toUpperCase() } : {}),
    ...(filter.industry ? { industry: filter.industry } : {}),
    ...(filter.ownerMembershipId ? { ownerMembershipId: filter.ownerMembershipId } : {}),
    ...(filter.importBatchId
      ? { sources: { some: { importBatchId: filter.importBatchId } } }
      : {}),
    ...(filter.duplicatesOnly
      ? { sources: { some: { duplicateOfAccountId: { not: null } } } }
      : {}),
    ...(filter.search
      ? {
          OR: [
            { name: { contains: filter.search, mode: "insensitive" } },
            { domainNormalized: { contains: filter.search.toLowerCase() } },
          ],
        }
      : {}),
  };
  const [total, accounts] = await Promise.all([
    prisma.growthAccount.count({ where }),
    prisma.growthAccount.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
      include: {
        targetProfile: { select: { name: true } },
        sources: {
          where: { duplicateOfAccountId: { not: null } },
          select: { id: true },
          take: 1,
        },
      },
    }),
  ]);
  return { total, page, pageSize: take, accounts };
}
