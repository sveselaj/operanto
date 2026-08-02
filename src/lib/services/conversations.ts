import "server-only";
import type {
  ConversationPriority,
  ConversationStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import {
  recordCustomerIdentity,
  removeCustomerIdentity,
} from "@/lib/services/customer-identity";

/**
 * Conversation reads/writes (Operanto Conversations, Slice 1).
 *
 * Every function takes the resolved OrgContext and applies BOTH the org scope
 * and (for operators) the record-level filter, so an id from the URL can never
 * cross either boundary. Message bodies and note bodies never appear in audit
 * metadata — audit rows outlive retention and erasure, so they carry ids and
 * state transitions only.
 */

export const CONVERSATION_STATUSES: ConversationStatus[] = [
  "OPEN",
  "PENDING",
  "RESOLVED",
  "ARCHIVED",
];

export const CONVERSATION_PRIORITIES: ConversationPriority[] = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
];

const MAX_BODY_LENGTH = 10_000;
const MAX_SUBJECT_LENGTH = 200;
export const CONVERSATION_PAGE_SIZE = 50;

/** Org + record-level scope: operators see conversations they are assigned or created. */
export function conversationAccessWhere(
  ctx: OrgContext,
): Prisma.ConversationWhereInput {
  if (can(ctx.membership.role, "conversations:view_all")) return scope(ctx);
  return {
    ...scope(ctx),
    OR: [
      { assignedMembershipId: ctx.membership.id },
      { createdByMembershipId: ctx.membership.id },
    ],
  };
}

export type ConversationListFilters = {
  status?: ConversationStatus;
  priority?: ConversationPriority;
  /** "me" | "unassigned" | a membership id */
  assigned?: string;
  q?: string;
  /** Conversation id to continue after (cursor pagination). */
  cursor?: string;
};

const listInclude = {
  customer: { select: { id: true, name: true, erasedAt: true, restrictedAt: true } },
  assignee: { include: { user: { select: { name: true } } } },
  participants: { where: { type: "CUSTOMER" as const }, take: 1 },
  messages: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { body: true, direction: true, redactedAt: true, createdAt: true },
  },
} satisfies Prisma.ConversationInclude;

export async function listConversations(
  ctx: OrgContext,
  filters: ConversationListFilters = {},
) {
  requirePermission(ctx.membership.role, "conversations:view_assigned");

  const assigned =
    filters.assigned === "me"
      ? { assignedMembershipId: ctx.membership.id }
      : filters.assigned === "unassigned"
        ? { assignedMembershipId: null }
        : filters.assigned
          ? { assignedMembershipId: filters.assigned }
          : {};

  const q = filters.q?.trim();
  const search: Prisma.ConversationWhereInput = q
    ? {
        OR: [
          { subject: { contains: q, mode: "insensitive" } },
          { customer: { is: { name: { contains: q, mode: "insensitive" } } } },
          {
            participants: {
              some: { displayName: { contains: q, mode: "insensitive" } },
            },
          },
        ],
      }
    : {};

  const rows = await prisma.conversation.findMany({
    where: {
      ...conversationAccessWhere(ctx),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...assigned,
      ...search,
    },
    include: listInclude,
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    take: CONVERSATION_PAGE_SIZE + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > CONVERSATION_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, CONVERSATION_PAGE_SIZE) : rows;
  return { conversations: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
}

export async function getConversation(ctx: OrgContext, id: string) {
  requirePermission(ctx.membership.role, "conversations:view_assigned");
  return prisma.conversation.findFirst({
    where: { ...conversationAccessWhere(ctx), id },
    include: {
      customer: true,
      connection: true,
      assignee: { include: { user: { select: { name: true, email: true } } } },
      participants: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: 200,
        include: { sender: { include: { user: { select: { name: true } } } } },
      },
      notes: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { author: { include: { user: { select: { name: true } } } } },
      },
      activities: { orderBy: { occurredAt: "desc" }, take: 50 },
    },
  });
}

/** The manual channel connection for this organisation, created on first use. */
async function ensureManualConnection(tx: Prisma.TransactionClient, organisationId: string) {
  return tx.channelConnection.upsert({
    where: {
      organisationId_type_displayName: {
        organisationId,
        type: "MANUAL",
        displayName: "Manual entry",
      },
    },
    update: {},
    create: { organisationId, type: "MANUAL", displayName: "Manual entry" },
  });
}

async function findLinkableCustomer(
  ctx: OrgContext,
  tx: Prisma.TransactionClient,
  customerId: string,
) {
  const customer = await tx.customer.findFirst({
    where: { ...scope(ctx), id: customerId },
  });
  if (!customer) throw new Error("Customer not found in this organisation");
  if (customer.erasedAt) {
    throw new Error("This customer record was erased and can no longer be linked");
  }
  return customer;
}

export type CreateConversationInput = {
  subject?: string;
  customerId?: string;
  counterpartName?: string;
  priority?: ConversationPriority;
  assignedMembershipId?: string;
  initialMessage?: string;
};

export async function createManualConversation(
  ctx: OrgContext,
  input: CreateConversationInput,
) {
  requirePermission(ctx.membership.role, "conversations:create");

  const subject = input.subject?.trim() || null;
  if (subject && subject.length > MAX_SUBJECT_LENGTH) {
    throw new Error(`Subject must be at most ${MAX_SUBJECT_LENGTH} characters`);
  }
  const initialMessage = input.initialMessage?.trim() || null;
  if (initialMessage && initialMessage.length > MAX_BODY_LENGTH) {
    throw new Error(`Message must be at most ${MAX_BODY_LENGTH} characters`);
  }
  if (input.priority && !CONVERSATION_PRIORITIES.includes(input.priority)) {
    throw new Error("Unknown priority");
  }
  const counterpartName = input.counterpartName?.trim() || null;
  if (!input.customerId && !counterpartName) {
    throw new Error("Name the counterpart or link a customer");
  }

  if (input.assignedMembershipId) {
    const target = await prisma.membership.findFirst({
      where: { id: input.assignedMembershipId, ...scope(ctx), status: "ACTIVE" },
    });
    if (!target) throw new Error("Assignee is not an active member of this organisation");
    if (
      target.id !== ctx.membership.id &&
      !can(ctx.membership.role, "conversations:assign")
    ) {
      throw new Error("Missing permission: conversations:assign");
    }
  }

  const conversation = await prisma.$transaction(async (tx) => {
    const customer = input.customerId
      ? await findLinkableCustomer(ctx, tx, input.customerId)
      : null;
    const connection = await ensureManualConnection(tx, ctx.organisation.id);
    const now = new Date();

    const conversation = await tx.conversation.create({
      data: {
        organisationId: ctx.organisation.id,
        customerId: customer?.id ?? null,
        channelConnectionId: connection.id,
        channelType: "MANUAL",
        subject,
        priority: input.priority ?? "NORMAL",
        assignedMembershipId: input.assignedMembershipId ?? null,
        createdByMembershipId: ctx.membership.id,
        lastMessageAt: initialMessage ? now : null,
        lastOutboundAt: initialMessage ? now : null,
      },
    });

    await tx.conversationParticipant.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: conversation.id,
        type: "CUSTOMER",
        customerId: customer?.id ?? null,
        displayName: customer ? null : counterpartName,
      },
    });

    if (initialMessage) {
      await tx.message.create({
        data: {
          organisationId: ctx.organisation.id,
          conversationId: conversation.id,
          channelConnectionId: connection.id,
          direction: "OUTBOUND",
          senderType: "STAFF",
          senderMembershipId: ctx.membership.id,
          body: initialMessage,
        },
      });
      await tx.conversationParticipant.create({
        data: {
          organisationId: ctx.organisation.id,
          conversationId: conversation.id,
          type: "STAFF",
          membershipId: ctx.membership.id,
        },
      });
    }

    await tx.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: conversation.id,
        customerId: customer?.id ?? null,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType: "conversation.created",
        summary: "Conversation opened manually",
      },
    });

    return conversation;
  });

  await audit(ctx, {
    eventType: "conversation.created",
    targetType: "Conversation",
    targetId: conversation.id,
    after: {
      channelType: "MANUAL",
      customerId: conversation.customerId,
      priority: conversation.priority,
      assignedMembershipId: conversation.assignedMembershipId,
    },
  });
  return conversation;
}

/**
 * A staff-authored message on a manual conversation. Nothing is transmitted —
 * the record documents an interaction that happened outside Operanto.
 */
export async function addManualMessage(ctx: OrgContext, conversationId: string, body: string) {
  requirePermission(ctx.membership.role, "conversations:message");
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > MAX_BODY_LENGTH) {
    throw new Error(`Message must be 1–${MAX_BODY_LENGTH} characters`);
  }

  const existing = await prisma.conversation.findFirst({
    where: { ...conversationAccessWhere(ctx), id: conversationId },
    include: { customer: { select: { id: true, restrictedAt: true } } },
  });
  if (!existing) throw new Error("Conversation not found");
  if (existing.customer?.restrictedAt) {
    throw new Error(
      "Processing for this customer is restricted (GDPR Art. 18) — no new messages may be recorded",
    );
  }

  const message = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const message = await tx.message.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: existing.id,
        channelConnectionId: existing.channelConnectionId,
        direction: "OUTBOUND",
        senderType: "STAFF",
        senderMembershipId: ctx.membership.id,
        body: trimmed,
      },
    });
    await tx.conversation.update({
      where: { id: existing.id },
      data: { lastMessageAt: now, lastOutboundAt: now },
    });
    await tx.conversationParticipant.upsert({
      where: {
        organisationId_conversationId_membershipId: {
          organisationId: ctx.organisation.id,
          conversationId: existing.id,
          membershipId: ctx.membership.id,
        },
      },
      update: {},
      create: {
        organisationId: ctx.organisation.id,
        conversationId: existing.id,
        type: "STAFF",
        membershipId: ctx.membership.id,
      },
    });
    await tx.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: existing.id,
        customerId: existing.customerId,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType: "conversation.message_added",
        summary: "Manual message recorded",
      },
    });
    return message;
  });

  await audit(ctx, {
    eventType: "conversation.message_added",
    targetType: "Conversation",
    targetId: existing.id,
    after: { messageId: message.id, direction: "OUTBOUND", senderType: "STAFF" },
  });
  return message;
}

export async function addConversationNote(
  ctx: OrgContext,
  conversationId: string,
  body: string,
) {
  requirePermission(ctx.membership.role, "conversations:note");
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 5000) throw new Error("Note must be 1–5000 characters");

  const existing = await prisma.conversation.findFirst({
    where: { ...conversationAccessWhere(ctx), id: conversationId },
  });
  if (!existing) throw new Error("Conversation not found");

  const note = await prisma.$transaction(async (tx) => {
    const note = await tx.conversationNote.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: existing.id,
        authorMembershipId: ctx.membership.id,
        body: trimmed,
      },
    });
    await tx.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: existing.id,
        customerId: existing.customerId,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType: "conversation.note_added",
        summary: "Internal note added",
      },
    });
    return note;
  });

  await audit(ctx, {
    eventType: "conversation.note_added",
    targetType: "Conversation",
    targetId: existing.id,
    after: { noteId: note.id },
  });
  return note;
}

export async function assignConversation(
  ctx: OrgContext,
  conversationId: string,
  membershipId: string | null,
) {
  requirePermission(ctx.membership.role, "conversations:assign");
  const existing = await prisma.conversation.findFirst({
    where: { ...scope(ctx), id: conversationId },
  });
  if (!existing) throw new Error("Conversation not found");

  if (membershipId) {
    const target = await prisma.membership.findFirst({
      where: { id: membershipId, ...scope(ctx), status: "ACTIVE" },
    });
    if (!target) throw new Error("Assignee is not an active member of this organisation");
  }

  await prisma.$transaction(async (tx) => {
    await tx.conversation.update({
      where: { id: existing.id },
      data: { assignedMembershipId: membershipId },
    });
    await tx.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: existing.id,
        customerId: existing.customerId,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType: "conversation.assigned",
        summary: membershipId ? "Conversation reassigned" : "Conversation unassigned",
        metadata: {
          fromMembershipId: existing.assignedMembershipId,
          toMembershipId: membershipId,
        },
      },
    });
  });

  await audit(ctx, {
    eventType: "conversation.assigned",
    targetType: "Conversation",
    targetId: existing.id,
    before: { assignedMembershipId: existing.assignedMembershipId },
    after: { assignedMembershipId: membershipId },
  });
}

export async function changeConversationStatus(
  ctx: OrgContext,
  conversationId: string,
  status: ConversationStatus,
) {
  requirePermission(ctx.membership.role, "conversations:update");
  if (!CONVERSATION_STATUSES.includes(status)) throw new Error("Unknown status");
  if (status === "ARCHIVED") {
    requirePermission(ctx.membership.role, "conversations:archive");
  }

  const existing = await prisma.conversation.findFirst({
    where: { ...conversationAccessWhere(ctx), id: conversationId },
  });
  if (!existing) throw new Error("Conversation not found");
  if (existing.status === status) return existing;

  // Conditional claim on the previous status: two concurrent changes cannot
  // both win, and the losing request gets a clear error instead of silently
  // overwriting.
  const claimed = await prisma.conversation.updateMany({
    where: { ...scope(ctx), id: existing.id, status: existing.status },
    data: { status },
  });
  if (claimed.count === 0) {
    throw new Error("The conversation changed while you were editing — reload and retry");
  }

  await prisma.activity.create({
    data: {
      organisationId: ctx.organisation.id,
      conversationId: existing.id,
      customerId: existing.customerId,
      actorType: "STAFF",
      actorUserId: ctx.user.id,
      actorMembershipId: ctx.membership.id,
      activityType:
        status === "ARCHIVED" ? "conversation.archived" : "conversation.status_changed",
      summary:
        status === "ARCHIVED"
          ? "Conversation archived"
          : `Status changed from ${existing.status} to ${status}`,
      metadata: { fromStatus: existing.status, toStatus: status },
    },
  });
  await audit(ctx, {
    eventType:
      status === "ARCHIVED" ? "conversation.archived" : "conversation.status_changed",
    targetType: "Conversation",
    targetId: existing.id,
    before: { status: existing.status },
    after: { status },
  });
  return { ...existing, status };
}

export async function changeConversationPriority(
  ctx: OrgContext,
  conversationId: string,
  priority: ConversationPriority,
) {
  requirePermission(ctx.membership.role, "conversations:update");
  if (!CONVERSATION_PRIORITIES.includes(priority)) throw new Error("Unknown priority");

  const existing = await prisma.conversation.findFirst({
    where: { ...conversationAccessWhere(ctx), id: conversationId },
  });
  if (!existing) throw new Error("Conversation not found");
  if (existing.priority === priority) return existing;

  const claimed = await prisma.conversation.updateMany({
    where: { ...scope(ctx), id: existing.id, priority: existing.priority },
    data: { priority },
  });
  if (claimed.count === 0) {
    throw new Error("The conversation changed while you were editing — reload and retry");
  }

  await prisma.activity.create({
    data: {
      organisationId: ctx.organisation.id,
      conversationId: existing.id,
      customerId: existing.customerId,
      actorType: "STAFF",
      actorUserId: ctx.user.id,
      actorMembershipId: ctx.membership.id,
      activityType: "conversation.priority_changed",
      summary: `Priority changed from ${existing.priority} to ${priority}`,
      metadata: { fromPriority: existing.priority, toPriority: priority },
    },
  });
  await audit(ctx, {
    eventType: "conversation.priority_changed",
    targetType: "Conversation",
    targetId: existing.id,
    before: { priority: existing.priority },
    after: { priority },
  });
  return { ...existing, priority };
}

export async function linkConversationCustomer(
  ctx: OrgContext,
  conversationId: string,
  customerId: string,
) {
  requirePermission(ctx.membership.role, "conversations:link_customer");
  const existing = await prisma.conversation.findFirst({
    where: { ...scope(ctx), id: conversationId },
  });
  if (!existing) throw new Error("Conversation not found");
  if (existing.customerId === customerId) return;

  const identityRecorded = await prisma.$transaction(async (tx) => {
    const customer = await findLinkableCustomer(ctx, tx, customerId);
    // The channel reference of the counterpart, if the conversation has one —
    // linking is the explicit staff decision that "this sender IS this
    // customer", so it teaches the channel identity for future ingestion.
    const counterpart = await tx.conversationParticipant.findFirst({
      where: {
        ...scope(ctx),
        conversationId: existing.id,
        type: "CUSTOMER",
        customerId: null,
      },
    });
    await tx.conversation.update({
      where: { id: existing.id },
      data: { customerId: customer.id },
    });
    // The CUSTOMER participant row becomes the linked customer; its manual
    // display name is superseded by the customer record, but the channel
    // reference is preserved.
    await tx.conversationParticipant.deleteMany({
      where: {
        ...scope(ctx),
        conversationId: existing.id,
        type: "CUSTOMER",
        customerId: null,
      },
    });
    await tx.conversationParticipant.upsert({
      where: {
        organisationId_conversationId_customerId: {
          organisationId: ctx.organisation.id,
          conversationId: existing.id,
          customerId: customer.id,
        },
      },
      update: { externalRef: counterpart?.externalRef ?? undefined },
      create: {
        organisationId: ctx.organisation.id,
        conversationId: existing.id,
        type: "CUSTOMER",
        customerId: customer.id,
        externalRef: counterpart?.externalRef ?? null,
      },
    });
    let identityRecorded = false;
    if (counterpart?.externalRef) {
      await recordCustomerIdentity(tx, {
        organisationId: ctx.organisation.id,
        customerId: customer.id,
        channelType: existing.channelType,
        externalId: counterpart.externalRef,
        displayHandle: counterpart.displayName,
        source: "manual_link",
      });
      identityRecorded = true;
    }
    await tx.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: existing.id,
        customerId: customer.id,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType: "conversation.customer_linked",
        summary: identityRecorded
          ? "Conversation linked to customer (channel identity recorded)"
          : "Conversation linked to customer",
        metadata: { fromCustomerId: existing.customerId, toCustomerId: customer.id },
      },
    });
    return identityRecorded;
  });

  await audit(ctx, {
    eventType: "conversation.customer_linked",
    targetType: "Conversation",
    targetId: existing.id,
    before: { customerId: existing.customerId },
    after: {
      customerId,
      identityRecorded,
      channelType: existing.channelType,
    },
  });
}

export async function unlinkConversationCustomer(ctx: OrgContext, conversationId: string) {
  requirePermission(ctx.membership.role, "conversations:link_customer");
  const existing = await prisma.conversation.findFirst({
    where: { ...scope(ctx), id: conversationId },
    include: { customer: { select: { id: true, name: true, erasedAt: true } } },
  });
  if (!existing) throw new Error("Conversation not found");
  if (!existing.customerId) return;

  await prisma.$transaction(async (tx) => {
    const linkedParticipant = await tx.conversationParticipant.findFirst({
      where: {
        ...scope(ctx),
        conversationId: existing.id,
        type: "CUSTOMER",
        customerId: existing.customerId,
      },
    });
    await tx.conversation.update({
      where: { id: existing.id },
      data: { customerId: null },
    });
    await tx.conversationParticipant.deleteMany({
      where: { ...scope(ctx), conversationId: existing.id, type: "CUSTOMER" },
    });
    await tx.conversationParticipant.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: existing.id,
        type: "CUSTOMER",
        // Keep a neutral placeholder, never the unlinked customer's name —
        // unlinking must not smear personal data onto the conversation row.
        // The channel reference stays: it belongs to the conversation's
        // counterpart, not to the customer record that was unlinked.
        displayName: "Unlinked counterpart",
        externalRef: linkedParticipant?.externalRef ?? null,
      },
    });
    // Unlinking withdraws the identity claim this link established —
    // otherwise the very next inbound message would silently re-link.
    if (linkedParticipant?.externalRef && existing.customerId) {
      await removeCustomerIdentity(
        tx,
        ctx.organisation.id,
        existing.customerId,
        existing.channelType,
        linkedParticipant.externalRef,
      );
    }
    await tx.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: existing.id,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType: "conversation.customer_unlinked",
        summary: "Customer link removed",
        metadata: { fromCustomerId: existing.customerId },
      },
    });
  });

  await audit(ctx, {
    eventType: "conversation.customer_unlinked",
    targetType: "Conversation",
    targetId: existing.id,
    before: { customerId: existing.customerId },
    after: { customerId: null },
  });
}

/** Customers offered by the link picker. Gated by the same permission as linking. */
export async function listLinkableCustomers(ctx: OrgContext, q?: string) {
  requirePermission(ctx.membership.role, "conversations:link_customer");
  const term = q?.trim();
  return prisma.customer.findMany({
    where: {
      ...scope(ctx),
      erasedAt: null,
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              { email: { contains: term, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, email: true, restrictedAt: true },
    orderBy: { lastInteractionAt: "desc" },
    take: 20,
  });
}
