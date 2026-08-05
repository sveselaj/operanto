import "server-only";
import type { LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { crmEnabled } from "@/lib/crm-flag";
import {
  canTransition,
  allowedTransitions,
  requiresReason,
  requiresSchedule,
  isClosedStatus,
} from "@operanto/crm-leadstatus";
import { CALLBACK_TASK_TYPE, callbackPriorityFor } from "@operanto/crm-callbacks";
import { phoneWriteFields, normalizeEmail } from "@operanto/crm-phone";

/**
 * CRM lead lifecycle (OI-3) — the general commercial pipeline on the
 * platform spine. Rules come from the engine packages (see packages/README.md
 * and the CRIMSS repo's docs/OPERANTO_SHARED_SERVICES.md); this service owns
 * the bindings: tenancy scope, permissions, transactions, Activity + audit.
 *
 * Invariants preserved from the standalone CRM:
 * - Status changes ONLY through transitionLead: one transaction writing
 *   lead + LeadStatusHistory + Activity + AuditEvent.
 * - At most ONE open CALLBACK task per lead — upsert, never a second.
 * - Terminal statuses cancel open lead tasks (CANCELLED, not COMPLETED).
 * - callbackAt / nextActionAt are DERIVED — recomputed by
 *   syncLeadActionFields inside every mutating transaction.
 * - Do-not-contact is never bypassed and is set structurally by the
 *   DO_NOT_CONTACT status.
 */

export { allowedTransitions };

/** Org + assignment scope for the caller. */
export function leadAccessWhere(ctx: OrgContext): Prisma.LeadWhereInput {
  if (can(ctx.membership.role, "crm.leads.view_all")) return scope(ctx);
  return { ...scope(ctx), assignedMembershipId: ctx.membership.id };
}

function requireCrm(): void {
  // Server Actions re-check the flag; services enforce it too so no code
  // path can reach CRM data with the module disabled.
  if (!crmEnabled()) throw new Error("CRM is not enabled for this deployment");
}

const listInclude = {
  assignee: { include: { user: { select: { name: true } } } },
  customer: { select: { id: true, name: true, erasedAt: true } },
} satisfies Prisma.LeadInclude;

export async function listLeads(
  ctx: OrgContext,
  filters: { status?: LeadStatus; unassigned?: boolean } = {},
) {
  requireCrm();
  requirePermission(ctx.membership.role, "crm.leads.view_assigned");
  return prisma.lead.findMany({
    where: {
      ...leadAccessWhere(ctx),
      archivedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.unassigned ? { assignedMembershipId: null } : {}),
    },
    include: listInclude,
    orderBy: [{ nextActionAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function getLead(ctx: OrgContext, id: string) {
  requireCrm();
  requirePermission(ctx.membership.role, "crm.leads.view_assigned");
  return prisma.lead.findFirst({
    where: { ...leadAccessWhere(ctx), id },
    include: {
      assignee: { include: { user: { select: { name: true, email: true } } } },
      customer: { select: { id: true, name: true, erasedAt: true } },
      statusHistory: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { changedBy: { include: { user: { select: { name: true } } } } },
      },
      activities: { orderBy: { occurredAt: "desc" }, take: 100 },
      tasks: { orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 50 },
    },
  });
}

export interface CreateLeadInput {
  fullName: string;
  companyName?: string;
  phone?: string;
  email?: string;
  source?: string;
}

export async function createLead(ctx: OrgContext, input: CreateLeadInput) {
  requireCrm();
  requirePermission(ctx.membership.role, "crm.leads.create");

  const fullName = input.fullName.trim();
  if (!fullName || fullName.length > 200) {
    throw new Error("Name must be 1–200 characters");
  }
  const phoneFields = phoneWriteFields(input.phone);
  const emailNormalized = normalizeEmail(input.email);

  const lead = await prisma.$transaction(async (tx) => {
    const created = await tx.lead.create({
      data: {
        organisationId: ctx.organisation.id,
        fullName,
        companyName: input.companyName?.trim() || null,
        phone: phoneFields.phone,
        phoneNormalized: phoneFields.normalizedPhone,
        phoneCountry: phoneFields.phoneCountry,
        phoneNational: phoneFields.phoneNational,
        phoneExtension: phoneFields.phoneExtension,
        phoneStatus: phoneFields.phoneStatus,
        email: input.email?.trim() || null,
        emailNormalized,
        origin: "manual",
        source: input.source?.trim() || null,
        createdByMembershipId: ctx.membership.id,
        lastActivityAt: new Date(),
      },
    });
    await tx.leadStatusHistory.create({
      data: {
        organisationId: ctx.organisation.id,
        leadId: created.id,
        previousStatus: null,
        newStatus: "NEW",
        changedByMembershipId: ctx.membership.id,
      },
    });
    await tx.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        leadId: created.id,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType: "crm.lead.created",
        summary: "Lead created manually",
        metadata: { origin: "manual" },
      },
    });
    return created;
  });

  await audit(ctx, {
    eventType: "crm.lead.created",
    targetType: "Lead",
    targetId: lead.id,
    after: { origin: "manual", status: lead.status },
  });
  return lead;
}

/**
 * Recompute the DERIVED scheduling fields from open lead tasks. Every
 * transaction that touches this lead's tasks ends with this call — the
 * fields are never set ad hoc (consistency rule carried over from Phase 2).
 */
export async function syncLeadActionFields(
  tx: Prisma.TransactionClient,
  leadId: string,
): Promise<void> {
  const callbackTask = await tx.task.findFirst({
    where: { leadId, type: CALLBACK_TASK_TYPE, status: "OPEN", dueAt: { not: null } },
    orderBy: { dueAt: "asc" },
    select: { dueAt: true },
  });
  const earliestTask = await tx.task.findFirst({
    where: { leadId, status: "OPEN", dueAt: { not: null } },
    orderBy: { dueAt: "asc" },
    select: { dueAt: true },
  });
  await tx.lead.update({
    where: { id: leadId },
    data: {
      callbackAt: callbackTask?.dueAt ?? null,
      nextActionAt: earliestTask?.dueAt ?? null,
    },
  });
}

/** Field updates implied by a status target (mirrors the standalone CRM). */
function statusUpdateData(
  to: LeadStatus,
  reason: string | undefined,
  scheduledAt: Date | undefined,
  now: Date,
): Prisma.LeadUpdateInput {
  switch (to) {
    case "RETRY_LATER":
      // Schedule without a callback promise: nextActionAt is set directly
      // (no task in this slice); the callback field clears.
      return { callbackAt: null, nextActionAt: scheduledAt ?? null };
    case "CONVERTED":
      return { convertedAt: now, callbackAt: null, nextActionAt: null };
    case "LOST":
      return { lostAt: now, rejectionReason: reason, callbackAt: null, nextActionAt: null };
    case "REJECTED":
      return { rejectionReason: reason, callbackAt: null, nextActionAt: null };
    case "WRONG_NUMBER":
      return { rejectionReason: reason, nextActionAt: null };
    case "DO_NOT_CONTACT":
      return { doNotCall: true, rejectionReason: reason, callbackAt: null, nextActionAt: null };
    case "CALLBACK":
    case "APPOINTMENT":
      // Derived fields are recomputed by syncLeadActionFields after the
      // callback-task upsert.
      return {};
    default:
      return { callbackAt: null, nextActionAt: null };
  }
}

export interface TransitionLeadInput {
  to: LeadStatus;
  reason?: string;
  /** Required for CALLBACK / RETRY_LATER (validated against the machine). */
  scheduledAt?: Date;
}

export async function transitionLead(
  ctx: OrgContext,
  id: string,
  input: TransitionLeadInput,
) {
  requireCrm();
  requirePermission(ctx.membership.role, "crm.leads.transition");
  const now = new Date();
  const reason = input.reason?.trim() || undefined;

  const lead = await prisma.lead.findFirst({
    where: { ...leadAccessWhere(ctx), id, archivedAt: null },
  });
  if (!lead) throw new Error("Lead not found");
  if (!canTransition(lead.status, input.to)) {
    throw new Error(`Transition ${lead.status} → ${input.to} is not allowed`);
  }
  if (requiresReason(input.to) && !reason) {
    throw new Error("This status requires a reason");
  }
  if (requiresSchedule(input.to)) {
    if (!input.scheduledAt || input.scheduledAt.getTime() < now.getTime() - 60_000) {
      throw new Error("This status requires a future date");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: lead.id },
      data: {
        status: input.to,
        lastActivityAt: now,
        ...statusUpdateData(input.to, reason, input.scheduledAt, now),
      },
    });
    await tx.leadStatusHistory.create({
      data: {
        organisationId: ctx.organisation.id,
        leadId: lead.id,
        previousStatus: lead.status,
        newStatus: input.to,
        changedByMembershipId: ctx.membership.id,
        reason,
      },
    });
    await tx.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        leadId: lead.id,
        customerId: lead.customerId,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType:
          input.to === "CALLBACK" ? "crm.callback.scheduled" : "crm.lead.status_changed",
        summary: `Status changed from ${lead.status} to ${input.to}`,
        metadata: { fromStatus: lead.status, toStatus: input.to },
      },
    });

    if (input.to === "CALLBACK" && input.scheduledAt) {
      // THE open callback task (invariant: at most one per lead) — upsert.
      const existing = await tx.task.findFirst({
        where: { leadId: lead.id, type: CALLBACK_TASK_TYPE, status: "OPEN" },
        select: { id: true },
      });
      if (existing) {
        await tx.task.update({
          where: { id: existing.id },
          data: { dueAt: input.scheduledAt, assignedMembershipId: lead.assignedMembershipId ?? ctx.membership.id },
        });
      } else {
        await tx.task.create({
          data: {
            organisationId: ctx.organisation.id,
            leadId: lead.id,
            type: CALLBACK_TASK_TYPE,
            title: lead.fullName,
            priority: callbackPriorityFor("CALLBACK"),
            status: "OPEN",
            dueAt: input.scheduledAt,
            assignedMembershipId: lead.assignedMembershipId ?? ctx.membership.id,
            createdByMembershipId: ctx.membership.id,
          },
        });
      }
    }

    if (isClosedStatus(input.to) || input.to === "WRONG_NUMBER") {
      // Terminal (and wrong-number) statuses cancel open lead work.
      await tx.task.updateMany({
        where: { leadId: lead.id, status: "OPEN" },
        data: { status: "CANCELLED" },
      });
    }

    await syncLeadActionFields(tx, lead.id);
    // RETRY_LATER schedules without a task; re-apply after the sync.
    if (input.to === "RETRY_LATER" && input.scheduledAt) {
      await tx.lead.update({
        where: { id: lead.id },
        data: { nextActionAt: input.scheduledAt },
      });
    }
  });

  await audit(ctx, {
    eventType: "crm.lead.status_changed",
    targetType: "Lead",
    targetId: lead.id,
    before: { status: lead.status },
    after: { status: input.to },
  });
}

export async function assignLead(
  ctx: OrgContext,
  id: string,
  membershipId: string | null,
) {
  requireCrm();
  requirePermission(ctx.membership.role, "crm.leads.assign");
  const existing = await prisma.lead.findFirst({
    where: { ...scope(ctx), id, archivedAt: null },
  });
  if (!existing) throw new Error("Lead not found");

  if (membershipId) {
    const target = await prisma.membership.findFirst({
      where: { id: membershipId, ...scope(ctx), status: "ACTIVE" },
    });
    if (!target) throw new Error("Assignee is not an active member of this organisation");
  }

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: existing.id },
      data: { assignedMembershipId: membershipId, lastActivityAt: new Date() },
    });
    // Open lead tasks follow the lead to the new assignee.
    if (membershipId) {
      await tx.task.updateMany({
        where: {
          leadId: existing.id,
          status: "OPEN",
          assignedMembershipId: existing.assignedMembershipId,
        },
        data: { assignedMembershipId: membershipId },
      });
    }
    await tx.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        leadId: existing.id,
        customerId: existing.customerId,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType: "crm.lead.assigned",
        summary: membershipId ? "Lead reassigned" : "Lead unassigned",
        metadata: {
          fromMembershipId: existing.assignedMembershipId,
          toMembershipId: membershipId,
        },
      },
    });
  });

  await audit(ctx, {
    eventType: "crm.lead.assigned",
    targetType: "Lead",
    targetId: existing.id,
    before: { assignedMembershipId: existing.assignedMembershipId },
    after: { assignedMembershipId: membershipId },
  });
}
