import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CRM operational workflow (OI-4) against real PostgreSQL: the work queue's
 * ordering and resting rule, the single-active-lock guarantee (partial unique
 * index) with audited override, and the calling workflow's follow-up
 * invariant — including that a call is ONE timeline entry and that erasure
 * reaches call history.
 */

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;

process.env.OPERANTO_ENCRYPTION_KEY =
  process.env.OPERANTO_ENCRYPTION_KEY ?? "ab".repeat(32);

const db = new PrismaClient({ datasourceUrl: TEST_URL ?? "postgresql://unused" });
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/org-context", () => ({
  scope: (c: { organisation: { id: string } }) => ({
    organisationId: c.organisation.id,
  }),
}));

const { createLead, transitionLead, assignLead } = await import("@/lib/services/crm/leads");
const { getWorkQueue, nextQueueLeadId } = await import("@/lib/services/crm/queue");
const { acquireLock, releaseLock, overrideLock, LOCK_TTL_MS } = await import(
  "@/lib/services/crm/locks"
);
const { startCall, recordCallOutcome, listAbandonedCalls } = await import(
  "@/lib/services/crm/calls"
);
const { listMyNotifications, unreadNotificationCount } = await import(
  "@/lib/services/crm/notifications"
);
const { eraseCustomer } = await import("@/lib/services/privacy");

type Role = "ADMIN" | "SUPERVISOR" | "OPERATOR" | "AUDITOR";
let seq = 0;

async function makeCtx(slug: string, role: Role = "ADMIN") {
  seq += 1;
  const organisation =
    (await db.organisation.findUnique({ where: { slug } })) ??
    (await db.organisation.create({ data: { name: slug, slug } }));
  const user = await db.user.create({
    data: {
      email: `wf${seq}-${Date.now()}@example.com`,
      name: `${role} ${seq}`,
      status: "ACTIVE",
    },
  });
  const membership = await db.membership.create({
    data: { organisationId: organisation.id, userId: user.id, role, status: "ACTIVE" },
  });
  return {
    organisation,
    membership,
    user: { id: user.id, name: user.name, email: user.email },
  };
}

const future = (h: number) => new Date(Date.now() + h * 3_600_000);
const past = (h: number) => new Date(Date.now() - h * 3_600_000);

beforeEach(() => {
  process.env.OPERANTO_CRM_ENABLED = "1";
});

afterAll(async () => {
  delete process.env.OPERANTO_CRM_ENABLED;
  await db.$disconnect();
});

describeDb("work queue", () => {
  it("orders overdue callbacks first and rests future ones", async () => {
    const ctx = await makeCtx("wf-queue-a");
    const overdue = await createLead(ctx, { fullName: "Overdue", phone: "+4915100000001" });
    const later = await createLead(ctx, { fullName: "Later", phone: "+4915100000002" });
    const fresh = await createLead(ctx, { fullName: "Fresh", phone: "+4915100000003" });
    for (const lead of [overdue, later, fresh]) {
      await assignLead(ctx, lead.id, ctx.membership.id);
    }
    await transitionLead(ctx, overdue.id, { to: "CONTACTED" });
    await transitionLead(ctx, later.id, { to: "CONTACTED" });
    await transitionLead(ctx, overdue.id, { to: "CALLBACK", scheduledAt: future(1) });
    await transitionLead(ctx, later.id, { to: "CALLBACK", scheduledAt: future(48) });
    // Backdate the first callback so it is genuinely overdue.
    await db.task.updateMany({ where: { leadId: overdue.id }, data: { dueAt: past(2) } });
    await db.lead.update({
      where: { id: overdue.id },
      data: { callbackAt: past(2), nextActionAt: past(2) },
    });

    const queue = await getWorkQueue(ctx);
    const ids = queue.map((entry) => entry.lead.id);
    expect(ids[0]).toBe(overdue.id);
    expect(queue[0].category).toBe("CALLBACK_OVERDUE");
    // A callback due in two days rests — it is not work for today.
    expect(ids).not.toContain(later.id);
    // A brand-new lead is queued as work.
    expect(ids).toContain(fresh.id);

    expect(await nextQueueLeadId(ctx, overdue.id)).not.toBe(overdue.id);
  });

  it("excludes do-not-contact, terminal and other people's leads", async () => {
    const ctx = await makeCtx("wf-queue-b");
    const other = await makeCtx("wf-queue-b", "OPERATOR");
    const dnc = await createLead(ctx, { fullName: "DNC" });
    const lost = await createLead(ctx, { fullName: "Lost" });
    const theirs = await createLead(ctx, { fullName: "Theirs" });
    await assignLead(ctx, dnc.id, ctx.membership.id);
    await assignLead(ctx, lost.id, ctx.membership.id);
    await assignLead(ctx, theirs.id, other.membership.id);
    await transitionLead(ctx, dnc.id, { to: "DO_NOT_CONTACT", reason: "asked" });
    await transitionLead(ctx, lost.id, { to: "LOST", reason: "no budget" });

    const ids = (await getWorkQueue(ctx)).map((entry) => entry.lead.id);
    expect(ids).not.toContain(dnc.id);
    expect(ids).not.toContain(lost.id);
    expect(ids).not.toContain(theirs.id);
  });
});

describeDb("work locks", () => {
  it("allows exactly one active holder and refreshes for the same member", async () => {
    const ctx = await makeCtx("wf-lock-a");
    const rival = await makeCtx("wf-lock-a", "OPERATOR");
    const lead = await createLead(ctx, { fullName: "Locked" });

    const first = await acquireLock(ctx, lead.id);
    expect(first.acquired).toBe(true);

    const second = await acquireLock(rival, lead.id);
    expect(second.acquired).toBe(false);
    expect(second.holder?.membershipId).toBe(ctx.membership.id);

    // Same member re-acquiring refreshes rather than failing.
    const again = await acquireLock(ctx, lead.id);
    expect(again.acquired).toBe(true);
    expect(await db.leadWorkLock.count({ where: { leadId: lead.id, releasedAt: null } })).toBe(1);

    await releaseLock(ctx, lead.id, "EXIT");
    expect((await acquireLock(rival, lead.id)).acquired).toBe(true);
  });

  it("sweeps an expired lock instead of blocking forever", async () => {
    const ctx = await makeCtx("wf-lock-b");
    const rival = await makeCtx("wf-lock-b", "OPERATOR");
    const lead = await createLead(ctx, { fullName: "Expiring" });
    await acquireLock(ctx, lead.id);
    await db.leadWorkLock.updateMany({
      where: { leadId: lead.id, releasedAt: null },
      data: { expiresAt: new Date(Date.now() - LOCK_TTL_MS) },
    });

    expect((await acquireLock(rival, lead.id)).acquired).toBe(true);
    const expired = await db.leadWorkLock.findFirst({
      where: { leadId: lead.id, releaseReason: "EXPIRED" },
    });
    expect(expired).not.toBeNull();
  });

  it("override is supervisor-tier, audited, and notifies the displaced holder", async () => {
    const ctx = await makeCtx("wf-lock-c");
    const holder = await makeCtx("wf-lock-c", "OPERATOR");
    const lead = await createLead(ctx, { fullName: "Contested" });
    await acquireLock(holder, lead.id);

    await overrideLock(ctx, lead.id);
    const active = await db.leadWorkLock.findFirst({
      where: { leadId: lead.id, releasedAt: null },
    });
    expect(active?.membershipId).toBe(ctx.membership.id);

    expect(await unreadNotificationCount(holder)).toBeGreaterThan(0);
    const notifications = await listMyNotifications(holder);
    expect(notifications[0].type).toBe("LOCK_OVERRIDDEN");
    // …and the displaced holder sees only their own.
    expect(await unreadNotificationCount(ctx)).toBe(0);

    const auditRow = await db.auditEvent.findFirst({
      where: { eventType: "crm.lock.overridden", targetId: lead.id },
    });
    expect(auditRow).not.toBeNull();
  });
});

describeDb("calling workflow", () => {
  it("records the attempt before the dial and enforces the follow-up invariant", async () => {
    const ctx = await makeCtx("wf-call-a");
    const lead = await createLead(ctx, { fullName: "Callee", phone: "+49 151 00000009" });
    const started = await startCall(ctx, lead.id);
    expect(started.attemptId).toBeTruthy();
    expect(started.manualOutcome).toBe(true);

    // The attempt and its ONE activity exist already.
    const attempt = await db.callAttempt.findUnique({ where: { id: started.attemptId } });
    expect(attempt?.status).toBe("LAUNCHED");
    expect(attempt?.activityId).toBeTruthy();
    expect(await db.activity.count({ where: { leadId: lead.id, activityType: "crm.call.started" } })).toBe(1);

    // NO_ANSWER may not be closed without a retry.
    await expect(
      recordCallOutcome(ctx, {
        attemptId: started.attemptId,
        outcome: "NO_ANSWER",
        nextAction: { kind: "NONE" },
      }),
    ).rejects.toThrow(/valid follow-up/i);

    // A retry without a time is refused too.
    await expect(
      recordCallOutcome(ctx, {
        attemptId: started.attemptId,
        outcome: "NO_ANSWER",
        nextAction: { kind: "RETRY" },
      }),
    ).rejects.toThrow(/future date/i);

    await recordCallOutcome(ctx, {
      attemptId: started.attemptId,
      outcome: "NO_ANSWER",
      durationSeconds: 20,
      nextAction: { kind: "RETRY", at: future(3) },
    });

    const after = await db.callAttempt.findUnique({ where: { id: started.attemptId } });
    expect(after?.status).toBe("COMPLETED");
    expect(after?.outcome).toBe("NO_ANSWER");
    expect(after?.durationSource).toBe("manual");

    // Still ONE timeline entry for the call — mutated, not duplicated.
    const callActivities = await db.activity.count({
      where: { leadId: lead.id, activityType: { startsWith: "crm.call." } },
    });
    expect(callActivities).toBe(1);

    // Status progressed via the machine and the retry became THE callback task.
    const updated = await db.lead.findUnique({ where: { id: lead.id } });
    expect(updated?.status).toBe("NO_ANSWER_1");
    const callbacks = await db.task.findMany({
      where: { leadId: lead.id, type: "CALLBACK", status: "OPEN" },
    });
    expect(callbacks).toHaveLength(1);
    expect(updated?.nextActionAt?.getTime()).toBe(callbacks[0].dueAt?.getTime());

    // The same attempt cannot be settled twice.
    await expect(
      recordCallOutcome(ctx, {
        attemptId: started.attemptId,
        outcome: "CONNECTED",
        nextAction: { kind: "NONE", reason: "done" },
      }),
    ).rejects.toThrow(/already has an outcome/i);
  });

  it("refuses to call do-not-contact leads and leads held by someone else", async () => {
    const ctx = await makeCtx("wf-call-b");
    const rival = await makeCtx("wf-call-b", "OPERATOR");
    const dnc = await createLead(ctx, { fullName: "No Calls", phone: "+4915100000010" });
    await transitionLead(ctx, dnc.id, { to: "DO_NOT_CONTACT", reason: "asked" });
    await expect(startCall(ctx, dnc.id)).rejects.toThrow(/do-not-contact/i);

    const held = await createLead(ctx, { fullName: "Held", phone: "+4915100000011" });
    await acquireLock(rival, held.id);
    await expect(startCall(ctx, held.id)).rejects.toThrow(/Locked by/);
  });

  it("terminal outcomes cancel open work and set the structural flag", async () => {
    const ctx = await makeCtx("wf-call-c");
    const lead = await createLead(ctx, { fullName: "Ends", phone: "+4915100000012" });
    await transitionLead(ctx, lead.id, { to: "CONTACTED" });
    await transitionLead(ctx, lead.id, { to: "CALLBACK", scheduledAt: future(2) });

    const call = await startCall(ctx, lead.id);
    await recordCallOutcome(ctx, {
      attemptId: call.attemptId,
      outcome: "DO_NOT_CONTACT",
      reason: "asked us to stop",
      nextAction: { kind: "NONE" },
    });

    const updated = await db.lead.findUnique({ where: { id: lead.id } });
    expect(updated?.status).toBe("DO_NOT_CONTACT");
    expect(updated?.doNotCall).toBe(true);
    expect(updated?.callbackAt).toBeNull();
    expect(await db.task.count({ where: { leadId: lead.id, status: "OPEN" } })).toBe(0);
  });

  it("surfaces abandoned calls to supervisors", async () => {
    const ctx = await makeCtx("wf-call-d");
    const lead = await createLead(ctx, { fullName: "Abandoned", phone: "+4915100000013" });
    const call = await startCall(ctx, lead.id);
    await db.callAttempt.update({
      where: { id: call.attemptId },
      data: { createdAt: past(1) },
    });
    const abandoned = await listAbandonedCalls(ctx);
    expect(abandoned.map((a) => a.id)).toContain(call.attemptId);
  });

  it("erasure removes call content and open sessions", async () => {
    const ctx = await makeCtx("wf-call-e");
    const customer = await db.customer.create({
      data: { organisationId: ctx.organisation.id, name: "Erase Call", phone: "+4915100000014" },
    });
    const lead = await createLead(ctx, { fullName: "Erase Call", phone: "+4915100000014" });
    await db.lead.update({ where: { id: lead.id }, data: { customerId: customer.id } });
    const call = await startCall(ctx, lead.id);
    await recordCallOutcome(ctx, {
      attemptId: call.attemptId,
      outcome: "CONNECTED",
      note: "Said to call back after the holidays",
      nextAction: { kind: "NONE", reason: "will call later" },
    });

    await eraseCustomer(ctx, customer.id, "GDPR request");

    const erased = await db.callAttempt.findUnique({ where: { id: call.attemptId } });
    expect(erased).not.toBeNull(); // the fact of the call survives
    expect(erased?.dialedNumber).toBe("[erased]");
    expect(erased?.rawPhone).toBeNull();
    expect(erased?.note).toBeNull();
    expect(await db.leadWorkLock.count({ where: { leadId: lead.id, releasedAt: null } })).toBe(0);
  });
});
