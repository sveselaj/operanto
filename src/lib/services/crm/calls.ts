import "server-only";
import type { CallOutcome, LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import type { DialTarget } from "@operanto/crm-voice";
import {
  outcomeStatusTarget,
  planStatusPath,
  validateOutcomeDecision,
  type NextActionDecision,
} from "@operanto/crm-calloutcome";
import { CALLBACK_TASK_TYPE, callbackPriorityFor } from "@operanto/crm-callbacks";
import { getCallProvider } from "@operanto/crm-voice";
import { acquireLock, releaseLock } from "./locks";
import { nextQueueLeadId } from "./queue";
import { syncLeadActionFields } from "./leads";
import { notify } from "./notifications";

/**
 * Calling workflow (OI-4). Two steps, both transactional:
 *
 * 1. `startCall` creates the CallAttempt AND its Activity BEFORE the dial is
 *    handed to the provider — an abandoned call is still evidence.
 * 2. `recordCallOutcome` enforces the FOLLOW-UP INVARIANT: every outcome
 *    forces a valid next action (retry / callback / appointment / task /
 *    explicitly-justified none). The rules come from
 *    `@operanto/crm-calloutcome`; this service applies them in one
 *    transaction that also walks the status path, upserts THE callback task,
 *    re-syncs the derived scheduling fields and audits.
 *
 * Do-not-contact is never bypassed. Dialing itself is still provider-neutral:
 * `getCallProvider` returns a URI target today (MicroSIP); a live telephony
 * adapter (the connection settings already exist) will implement the same
 * `CallProvider` contract without touching this service.
 */

export interface StartCallResult {
  attemptId: string;
  dialTarget: DialTarget;
  /** URI providers cannot observe calls — the outcome is entered by hand. */
  manualOutcome: boolean;
}

export async function startCall(ctx: OrgContext, leadId: string): Promise<StartCallResult> {
  requirePermission(ctx.membership.role, "crm.calls.start");

  const lead = await prisma.lead.findFirst({
    where: { ...scope(ctx), id: leadId, archivedAt: null },
    select: {
      id: true,
      phone: true,
      phoneNormalized: true,
      phoneStatus: true,
      doNotCall: true,
      status: true,
      customerId: true,
    },
  });
  if (!lead) throw new Error("Lead not found");
  if (lead.doNotCall || lead.status === "DO_NOT_CONTACT") {
    throw new Error("This lead is marked do-not-contact");
  }
  if (!lead.phoneNormalized || lead.phoneStatus === "INVALID" || lead.phoneStatus === "MISSING") {
    throw new Error("No usable phone number — correct it before calling");
  }

  // The work lock is the concurrency guard: you may not call a lead someone
  // else is working.
  const lock = await acquireLock(ctx, leadId);
  if (!lock.acquired) {
    throw new Error(`Locked by ${lock.holder?.name ?? "another member"}`);
  }

  const provider = getCallProvider("microsip-tel");
  const dialTarget = provider.prepareDialTarget(lead.phoneNormalized);

  const attempt = await prisma.$transaction(async (tx) => {
    const created = await tx.callAttempt.create({
      data: {
        organisationId: ctx.organisation.id,
        leadId: lead.id,
        membershipId: ctx.membership.id,
        provider: provider.id,
        dialedNumber: lead.phoneNormalized!,
        rawPhone: lead.phone,
      },
    });
    const activity = await tx.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        leadId: lead.id,
        customerId: lead.customerId,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType: "crm.call.started",
        summary: "Call started",
        metadata: { callAttemptId: created.id, provider: provider.id },
      },
    });
    await tx.callAttempt.update({
      where: { id: created.id },
      data: { activityId: activity.id },
    });
    return created;
  });

  return {
    attemptId: attempt.id,
    dialTarget,
    manualOutcome: !provider.supportsCallEvents(),
  };
}

export interface RecordOutcomeInput {
  attemptId: string;
  outcome: CallOutcome;
  note?: string;
  durationSeconds?: number;
  reason?: string;
  nextAction: NextActionDecision;
}

export async function recordCallOutcome(
  ctx: OrgContext,
  input: RecordOutcomeInput,
): Promise<void> {
  requirePermission(ctx.membership.role, "crm.calls.record_outcome");
  const now = new Date();
  const reason = input.reason?.trim() || undefined;

  const attempt = await prisma.callAttempt.findFirst({
    where: { ...scope(ctx), id: input.attemptId },
    include: {
      lead: {
        select: {
          id: true,
          status: true,
          fullName: true,
          customerId: true,
          assignedMembershipId: true,
        },
      },
    },
  });
  if (!attempt) throw new Error("Call attempt not found");
  if (attempt.status !== "LAUNCHED") throw new Error("This call already has an outcome");

  // The follow-up invariant, enforced by the engine before anything is written.
  const validation = validateOutcomeDecision(input.outcome, input.nextAction, reason, now);
  if (!validation.ok) throw new Error(validationMessage(validation.code));

  const lead = attempt.lead;
  const statusPath = planStatusPath(
    lead.status,
    outcomeStatusTarget(input.outcome, lead.status),
  );

  await prisma.$transaction(async (tx) => {
    // 1. The attempt and its existing Activity (mutated in place — a call is
    //    ONE timeline entry, not two).
    await tx.callAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "COMPLETED",
        outcome: input.outcome,
        outcomeRecordedAt: now,
        durationSeconds: input.durationSeconds,
        durationSource: input.durationSeconds === undefined ? null : "manual",
        note: input.note?.trim() || null,
      },
    });
    if (attempt.activityId) {
      await tx.activity.update({
        where: { id: attempt.activityId },
        data: {
          activityType: "crm.call.outcome_recorded",
          summary: `Call outcome: ${input.outcome}`,
          metadata: {
            callAttemptId: attempt.id,
            outcome: input.outcome,
            durationSeconds: input.durationSeconds ?? null,
          },
        },
      });
    }

    // 2. Status path (may insert CONTACTED as an intermediate hop).
    let current = lead.status;
    for (const target of statusPath) {
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: target,
          lastActivityAt: now,
          ...terminalFields(target, reason, now),
        },
      });
      await tx.leadStatusHistory.create({
        data: {
          organisationId: ctx.organisation.id,
          leadId: lead.id,
          previousStatus: current,
          newStatus: target,
          changedByMembershipId: ctx.membership.id,
          reason: target === statusPath[statusPath.length - 1] ? reason : undefined,
        },
      });
      current = target;
    }

    // 3. The follow-up itself.
    const decision = input.nextAction;
    const openCallback = await tx.task.findFirst({
      where: { leadId: lead.id, type: CALLBACK_TASK_TYPE, status: "OPEN" },
      select: { id: true },
    });

    if ((decision.kind === "RETRY" || decision.kind === "CALLBACK") && decision.at) {
      // THE open callback task — upsert, never a second one.
      if (openCallback) {
        await tx.task.update({
          where: { id: openCallback.id },
          data: {
            dueAt: decision.at,
            priority: callbackPriorityFor(decision.kind),
            assignedMembershipId: lead.assignedMembershipId ?? ctx.membership.id,
          },
        });
      } else {
        await tx.task.create({
          data: {
            organisationId: ctx.organisation.id,
            leadId: lead.id,
            type: CALLBACK_TASK_TYPE,
            title: lead.fullName,
            status: "OPEN",
            priority: callbackPriorityFor(decision.kind),
            dueAt: decision.at,
            assignedMembershipId: lead.assignedMembershipId ?? ctx.membership.id,
            createdByMembershipId: ctx.membership.id,
          },
        });
      }
      await tx.activity.create({
        data: {
          organisationId: ctx.organisation.id,
          leadId: lead.id,
          customerId: lead.customerId,
          actorType: "STAFF",
          actorUserId: ctx.user.id,
          actorMembershipId: ctx.membership.id,
          activityType: "crm.callback.scheduled",
          summary: "Callback scheduled",
          metadata: { dueAt: decision.at.toISOString(), viaCall: attempt.id },
        },
      });
      // Someone else's lead: tell them it moved.
      if (lead.assignedMembershipId && lead.assignedMembershipId !== ctx.membership.id) {
        await notify(tx, {
          organisationId: ctx.organisation.id,
          membershipId: lead.assignedMembershipId,
          type: "CALLBACK_DUE",
          titleKey: "callbackScheduled",
          messageKey: "callbackScheduledMessage",
          entityType: "Lead",
          entityId: lead.id,
          metadata: { dueAt: decision.at.toISOString() },
        });
      }
    } else if (decision.kind === "TASK" && decision.at) {
      await tx.task.create({
        data: {
          organisationId: ctx.organisation.id,
          leadId: lead.id,
          type: decision.taskType ?? "FOLLOW_UP",
          title: decision.title?.trim() || lead.fullName,
          status: "OPEN",
          dueAt: decision.at,
          assignedMembershipId: lead.assignedMembershipId ?? ctx.membership.id,
          createdByMembershipId: ctx.membership.id,
        },
      });
    } else if (decision.kind === "NONE") {
      // Non-callback outcomes settle any open callback: it is no longer owed.
      if (openCallback) {
        await tx.task.update({
          where: { id: openCallback.id },
          data: { status: "COMPLETED", completedAt: now },
        });
      }
    }

    // 4. Terminal outcomes cancel remaining open work.
    if (current === "REJECTED" || current === "WRONG_NUMBER" || current === "DO_NOT_CONTACT") {
      await tx.task.updateMany({
        where: { leadId: lead.id, status: "OPEN" },
        data: { status: "CANCELLED" },
      });
    }

    await tx.lead.update({ where: { id: lead.id }, data: { lastActivityAt: now } });
    await syncLeadActionFields(tx, lead.id);
  });

  await audit(ctx, {
    eventType: "crm.call.outcome_recorded",
    targetType: "CallAttempt",
    targetId: attempt.id,
    after: { outcome: input.outcome, leadId: lead.id },
  });
}

/**
 * Save the outcome, then release the lock and hand back the next lead —
 * the lock is released ONLY after a successful save, so a failed save never
 * loses the work session.
 */
export async function recordOutcomeAndNext(
  ctx: OrgContext,
  input: RecordOutcomeInput,
  leadId: string,
): Promise<{ nextLeadId: string | null }> {
  await recordCallOutcome(ctx, input);
  await releaseLock(ctx, leadId, "NEXT");
  return { nextLeadId: await nextQueueLeadId(ctx, leadId) };
}

export async function cancelCallAttempt(
  ctx: OrgContext,
  attemptId: string,
  cancelReason: string,
): Promise<void> {
  requirePermission(ctx.membership.role, "crm.calls.record_outcome");
  const result = await prisma.callAttempt.updateMany({
    where: { ...scope(ctx), id: attemptId, status: "LAUNCHED" },
    data: { status: "CANCELLED", cancelReason: cancelReason.trim().slice(0, 200) },
  });
  if (result.count === 0) throw new Error("Call attempt not found or already settled");
}

/** Launched attempts with no outcome — the supervisor's exception view. */
export async function listAbandonedCalls(ctx: OrgContext, olderThanMinutes = 15) {
  requirePermission(ctx.membership.role, "crm.leads.view_all");
  return prisma.callAttempt.findMany({
    where: {
      ...scope(ctx),
      status: "LAUNCHED",
      createdAt: { lt: new Date(Date.now() - olderThanMinutes * 60_000) },
    },
    include: {
      lead: { select: { id: true, fullName: true } },
      caller: { include: { user: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

function terminalFields(
  status: LeadStatus,
  reason: string | undefined,
  now: Date,
): Prisma.LeadUpdateInput {
  switch (status) {
    case "REJECTED":
      return { rejectionReason: reason };
    case "WRONG_NUMBER":
      return { rejectionReason: reason };
    case "DO_NOT_CONTACT":
      return { doNotCall: true, rejectionReason: reason };
    case "LOST":
      return { lostAt: now, rejectionReason: reason };
    case "CONVERTED":
      return { convertedAt: now };
    default:
      return {};
  }
}

function validationMessage(code: string): string {
  switch (code) {
    case "reasonRequired":
      return "This outcome requires a reason";
    case "scheduleRequired":
      return "This follow-up requires a future date";
    case "nextActionRequired":
      return "Choose a valid follow-up for this outcome";
    default:
      return "Invalid follow-up";
  }
}
