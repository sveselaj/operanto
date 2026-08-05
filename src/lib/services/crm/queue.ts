import "server-only";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import {
  buildWorkQueue,
  QUEUE_EXCLUDED_STATUSES,
  type QueueCandidate,
  type QueueEntry,
} from "@operanto/crm-workqueue";

/**
 * Work queue (OI-4): "what should I do next", computed deterministically.
 *
 * The ordering, categories, resting rules and tie-breaks live in
 * `@operanto/crm-workqueue` (pure, unit-tested). This service does exactly
 * two things the engine must never do: fetch candidates inside the tenant +
 * assignment scope, and hand the engine a `now`.
 *
 * Principal mapping: the engine compares opaque ids, so the platform's
 * MEMBERSHIP id is passed where the standalone CRM passed a user id.
 */

/** End of the caller's working day — the "due today" boundary. */
function endOfToday(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  // 23:59:59.999 local, expressed as an instant.
  const local = new Date(`${get("year")}-${get("month")}-${get("day")}T23:59:59.999`);
  const offset = local.getTime() - new Date(local.toLocaleString("en-US", { timeZone })).getTime();
  return new Date(local.getTime() + offset);
}

export async function getWorkQueue(
  ctx: OrgContext,
  options: { now?: Date; timeZone?: string } = {},
): Promise<QueueEntry[]> {
  requirePermission(ctx.membership.role, "crm.leads.view_assigned");
  const now = options.now ?? new Date();

  const leads = await prisma.lead.findMany({
    where: {
      ...scope(ctx),
      archivedAt: null,
      doNotCall: false,
      assignedMembershipId: ctx.membership.id,
      status: { notIn: [...QUEUE_EXCLUDED_STATUSES] },
    },
    select: {
      id: true,
      fullName: true,
      companyName: true,
      phone: true,
      status: true,
      doNotCall: true,
      archivedAt: true,
      assignedMembershipId: true,
      lastActivityAt: true,
      nextActionAt: true,
      createdAt: true,
      tasks: {
        where: { status: "OPEN" },
        select: { id: true, type: true, status: true, dueAt: true },
      },
      workLocks: {
        where: { releasedAt: null },
        select: {
          membershipId: true,
          expiresAt: true,
          holder: { include: { user: { select: { name: true } } } },
        },
        take: 1,
      },
    },
    take: 500,
  });

  const candidates: QueueCandidate[] = leads.map((lead) => ({
    id: lead.id,
    fullName: lead.fullName,
    companyName: lead.companyName,
    phone: lead.phone,
    status: lead.status,
    doNotCall: lead.doNotCall,
    archivedAt: lead.archivedAt,
    assignedUserId: lead.assignedMembershipId,
    lastActivityAt: lead.lastActivityAt,
    nextActionAt: lead.nextActionAt,
    createdAt: lead.createdAt,
    openTasks: lead.tasks.map((task) => ({
      id: task.id,
      // CRM task types are string-typed on the shared Task model; the engine
      // only distinguishes CALLBACK from the rest.
      type: (task.type ?? "FOLLOW_UP") as QueueCandidate["openTasks"][number]["type"],
      status: "OPEN",
      dueAt: task.dueAt,
    })),
    // Appointments arrive with the scheduling slice; the engine treats a
    // missing appointment as "no preparation due".
    nextAppointment: null,
    activeLock: lead.workLocks[0]
      ? {
          userId: lead.workLocks[0].membershipId,
          userName: lead.workLocks[0].holder.user.name,
          expiresAt: lead.workLocks[0].expiresAt,
        }
      : null,
  }));

  return buildWorkQueue(
    candidates,
    ctx.membership.id,
    now,
    endOfToday(now, options.timeZone ?? "Europe/Berlin"),
  );
}

/** The next lead to work after finishing one — powers "save and next". */
export async function nextQueueLeadId(
  ctx: OrgContext,
  excludeLeadId?: string,
): Promise<string | null> {
  const queue = await getWorkQueue(ctx);
  const next = queue.find((entry) => entry.lead.id !== excludeLeadId);
  return next?.lead.id ?? null;
}
