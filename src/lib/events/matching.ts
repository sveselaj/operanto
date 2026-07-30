import "server-only";
import type { Prisma } from "@prisma/client";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";

/**
 * Customer matching (docs/customer-matching.md).
 *
 * Priority: exact source customer id → exact normalized email → exact
 * normalized phone → create a new customer. Never merges by name, language,
 * inquiry text, or IP. The winning rule is recorded on the customer row and in
 * the returned result so the timeline can explain WHY a match happened.
 */

export type CustomerIdentity = {
  sourceSystem: string;
  sourceCustomerId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  preferredLanguage?: string | null;
  preferredChannel?: string | null;
};

export type MatchResult = {
  customerId: string;
  created: boolean;
  matchReason:
    | "source_customer_id"
    | "email_exact"
    | "phone_exact"
    | "created_new";
};

export async function findOrCreateCustomer(
  tx: Prisma.TransactionClient,
  organisationId: string,
  identity: CustomerIdentity,
  interactionAt: Date,
): Promise<MatchResult> {
  const emailNormalized = normalizeEmail(identity.email);
  const phoneNormalized = normalizePhone(identity.phone);

  let matchReason: MatchResult["matchReason"] | null = null;
  let existing = null;

  if (identity.sourceCustomerId) {
    existing = await tx.customer.findUnique({
      where: {
        organisationId_sourceSystem_sourceCustomerId: {
          organisationId,
          sourceSystem: identity.sourceSystem,
          sourceCustomerId: identity.sourceCustomerId,
        },
      },
    });
    if (existing) matchReason = "source_customer_id";
  }

  if (!existing && emailNormalized) {
    existing = await tx.customer.findFirst({
      where: { organisationId, emailNormalized },
      orderBy: { createdAt: "asc" },
    });
    if (existing) matchReason = "email_exact";
  }

  if (!existing && phoneNormalized) {
    existing = await tx.customer.findFirst({
      where: { organisationId, phoneNormalized },
      orderBy: { createdAt: "asc" },
    });
    if (existing) matchReason = "phone_exact";
  }

  if (existing && matchReason) {
    await tx.customer.update({
      where: { id: existing.id },
      data: {
        // Fill gaps only — never overwrite verified identity fields with
        // possibly different inbound values (that would be an implicit merge).
        name: existing.name ?? identity.name ?? undefined,
        email: existing.email ?? identity.email ?? undefined,
        emailNormalized: existing.emailNormalized ?? emailNormalized ?? undefined,
        phone: existing.phone ?? identity.phone ?? undefined,
        phoneNormalized: existing.phoneNormalized ?? phoneNormalized ?? undefined,
        preferredLanguage: identity.preferredLanguage ?? existing.preferredLanguage,
        preferredChannel: identity.preferredChannel ?? existing.preferredChannel,
        matchReason,
        lastInteractionAt: interactionAt,
        firstInteractionAt: existing.firstInteractionAt ?? interactionAt,
      },
    });
    return { customerId: existing.id, created: false, matchReason };
  }

  const created = await tx.customer.create({
    data: {
      organisationId,
      sourceSystem: identity.sourceSystem,
      sourceCustomerId: identity.sourceCustomerId ?? null,
      name: identity.name ?? null,
      email: identity.email ?? null,
      emailNormalized,
      phone: identity.phone ?? null,
      phoneNormalized,
      preferredLanguage: identity.preferredLanguage ?? null,
      preferredChannel: identity.preferredChannel ?? null,
      matchReason: "created_new",
      firstInteractionAt: interactionAt,
      lastInteractionAt: interactionAt,
    },
  });
  return { customerId: created.id, created: true, matchReason: "created_new" };
}
