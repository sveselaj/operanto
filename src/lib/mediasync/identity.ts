import "server-only";
import type { ChannelType, Customer, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "./phone";

/**
 * MediaSync — customer identity resolution.
 *
 * The communication layer's job is to make "the same person on WhatsApp, email
 * and Instagram" resolve to one Customer. We match on normalized phone, email,
 * and per-channel social handle / external id, following merge chains so a
 * record that was merged away never resurfaces.
 */

export type IdentityCandidate = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  handle?: string | null;
  externalId?: string | null;
};

export type ResolveOptions = {
  channelType: ChannelType;
  defaultCountryCode?: string | null;
};

/** Follow `mergedIntoId` to the surviving (canonical) customer record. */
async function resolveCanonical(customer: Customer): Promise<Customer> {
  let current = customer;
  // Guard against cycles; merge chains are shallow in practice.
  for (let i = 0; i < 10 && current.mergedIntoId; i++) {
    const next = await prisma.customer.findUnique({ where: { id: current.mergedIntoId } });
    if (!next) break;
    current = next;
  }
  return current;
}

/**
 * Find an existing customer matching the candidate, or null. Matching is
 * scoped to the workspace and ordered: email, normalized phone, then the
 * channel-specific handle / external id stored in `socialHandles`.
 */
export async function findMatchingCustomer(
  workspaceId: string,
  candidate: IdentityCandidate,
  opts: ResolveOptions,
): Promise<Customer | null> {
  const phoneNormalized = normalizePhone(candidate.phone, opts.defaultCountryCode);
  const or: Prisma.CustomerWhereInput[] = [];

  if (candidate.email) or.push({ email: candidate.email });
  if (phoneNormalized) or.push({ phoneNormalized });
  if (candidate.handle)
    or.push({ socialHandles: { path: [opts.channelType], equals: candidate.handle } });
  if (candidate.externalId)
    or.push({ socialHandles: { path: ["externalId"], equals: candidate.externalId } });

  if (or.length === 0) return null;

  const match = await prisma.customer.findFirst({
    where: { workspaceId, OR: or },
    orderBy: { createdAt: "asc" },
  });
  return match ? resolveCanonical(match) : null;
}

/**
 * Resolve (find-or-create) the customer for an inbound message, enriching an
 * existing record with any newly-seen identifiers (e.g. first time we learn
 * their phone). Returns the canonical customer.
 */
export async function resolveCustomer(
  workspaceId: string,
  candidate: IdentityCandidate,
  opts: ResolveOptions,
): Promise<Customer> {
  const phoneNormalized = normalizePhone(candidate.phone, opts.defaultCountryCode);
  const existing = await findMatchingCustomer(workspaceId, candidate, opts);

  if (existing) {
    // Backfill identifiers we didn't have before; never overwrite existing data.
    const patch: Prisma.CustomerUpdateInput = {};
    if (candidate.email && !existing.email) patch.email = candidate.email;
    if (candidate.phone && !existing.phone) patch.phone = candidate.phone;
    if (phoneNormalized && !existing.phoneNormalized) patch.phoneNormalized = phoneNormalized;

    const handles = (existing.socialHandles as Record<string, string> | null) ?? {};
    let handlesChanged = false;
    if (candidate.handle && !handles[opts.channelType]) {
      handles[opts.channelType] = candidate.handle;
      handlesChanged = true;
    }
    if (candidate.externalId && !handles.externalId) {
      handles.externalId = candidate.externalId;
      handlesChanged = true;
    }
    if (handlesChanged) patch.socialHandles = handles as Prisma.InputJsonValue;

    if (Object.keys(patch).length === 0) return existing;
    return prisma.customer.update({ where: { id: existing.id }, data: patch });
  }

  const socialHandles: Record<string, string> = {};
  if (candidate.handle) socialHandles[opts.channelType] = candidate.handle;
  if (candidate.externalId) socialHandles.externalId = candidate.externalId;

  return prisma.customer.create({
    data: {
      workspaceId,
      name: candidate.name ?? candidate.handle ?? "Website visitor",
      email: candidate.email ?? null,
      phone: candidate.phone ?? null,
      phoneNormalized,
      socialHandles: Object.keys(socialHandles).length ? socialHandles : undefined,
    },
  });
}

/**
 * Merge `loserId` into `winnerId`: move conversations and consent rows to the
 * winner, backfill any fields the winner is missing, and tombstone the loser
 * via `mergedIntoId` so future lookups land on the winner.
 */
export async function mergeCustomers(
  workspaceId: string,
  winnerId: string,
  loserId: string,
): Promise<Customer> {
  if (winnerId === loserId) throw new Error("Cannot merge a customer into itself");

  const [winner, loser] = await Promise.all([
    prisma.customer.findFirst({ where: { id: winnerId, workspaceId } }),
    prisma.customer.findFirst({ where: { id: loserId, workspaceId } }),
  ]);
  if (!winner) throw new Error("Winner customer not found");
  if (!loser) throw new Error("Loser customer not found");

  const patch: Prisma.CustomerUpdateInput = {};
  if (!winner.email && loser.email) patch.email = loser.email;
  if (!winner.phone && loser.phone) patch.phone = loser.phone;
  if (!winner.phoneNormalized && loser.phoneNormalized)
    patch.phoneNormalized = loser.phoneNormalized;
  if (!winner.name && loser.name) patch.name = loser.name;

  const winnerHandles = (winner.socialHandles as Record<string, string> | null) ?? {};
  const loserHandles = (loser.socialHandles as Record<string, string> | null) ?? {};
  const mergedHandles = { ...loserHandles, ...winnerHandles };
  patch.socialHandles = mergedHandles as Prisma.InputJsonValue;

  await prisma.$transaction(async (tx) => {
    await tx.conversation.updateMany({
      where: { workspaceId, customerId: loserId },
      data: { customerId: winnerId },
    });
    // Move consent rows that don't collide; the unique (customer, channel)
    // constraint means we only relocate channels the winner doesn't have yet.
    const winnerConsentChannels = await tx.consent.findMany({
      where: { customerId: winnerId },
      select: { channelType: true },
    });
    const taken = new Set(winnerConsentChannels.map((c) => c.channelType));
    const loserConsents = await tx.consent.findMany({ where: { customerId: loserId } });
    for (const c of loserConsents) {
      if (!taken.has(c.channelType)) {
        await tx.consent.update({ where: { id: c.id }, data: { customerId: winnerId } });
      }
    }
    await tx.customer.update({ where: { id: winnerId }, data: patch });
    await tx.customer.update({ where: { id: loserId }, data: { mergedIntoId: winnerId } });
  });

  return prisma.customer.findUniqueOrThrow({ where: { id: winnerId } });
}
