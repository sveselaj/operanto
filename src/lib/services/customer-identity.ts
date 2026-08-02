import "server-only";
import type { ChannelType, Prisma } from "@prisma/client";

/**
 * Channel identities — the exact-match rung that lets channel ingestion
 * recognise a returning sender (Slice 2 of the consolidation plan).
 *
 * Same philosophy as the events identity ladder (src/lib/events/matching.ts):
 * exact keys only, no fuzzy rules, erased tombstones are never re-matched,
 * and a wrong link is considered worse than a missed one. Identities are
 * *taught* by explicit staff action (linking a conversation), never inferred.
 *
 * Both functions run inside the caller's transaction so an identity can never
 * outlive the write that justified it.
 */

/** Resolve a channel sender to a customer, or null. Never matches erased rows. */
export async function resolveCustomerByChannelIdentity(
  tx: Prisma.TransactionClient,
  organisationId: string,
  channelType: ChannelType,
  externalId: string,
) {
  const identity = await tx.customerIdentity.findUnique({
    where: {
      organisationId_channelType_externalId: {
        organisationId,
        channelType,
        externalId,
      },
    },
    include: { customer: true },
  });
  if (!identity) return null;
  // Erasure deletes identity rows, so this is belt-and-braces — but a race
  // between erasure and ingestion must still never repopulate a tombstone.
  if (identity.customer.erasedAt) return null;
  return identity.customer;
}

/**
 * Record (or move) a channel identity claim. An existing claim on the same
 * external id is overwritten: the caller is an explicit, audited staff
 * action, which outranks whatever the previous state was.
 */
export async function recordCustomerIdentity(
  tx: Prisma.TransactionClient,
  input: {
    organisationId: string;
    customerId: string;
    channelType: ChannelType;
    externalId: string;
    displayHandle?: string | null;
    source: string;
  },
) {
  return tx.customerIdentity.upsert({
    where: {
      organisationId_channelType_externalId: {
        organisationId: input.organisationId,
        channelType: input.channelType,
        externalId: input.externalId,
      },
    },
    update: {
      customerId: input.customerId,
      displayHandle: input.displayHandle ?? null,
      source: input.source,
    },
    create: {
      organisationId: input.organisationId,
      customerId: input.customerId,
      channelType: input.channelType,
      externalId: input.externalId,
      displayHandle: input.displayHandle ?? null,
      source: input.source,
    },
  });
}

/** Remove the identity claims a specific conversation link established. */
export async function removeCustomerIdentity(
  tx: Prisma.TransactionClient,
  organisationId: string,
  customerId: string,
  channelType: ChannelType,
  externalId: string,
) {
  await tx.customerIdentity.deleteMany({
    where: { organisationId, customerId, channelType, externalId },
  });
}
