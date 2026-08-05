import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CRM foundation (OI-3) against real PostgreSQL: tenant isolation, permission
 * enforcement, the lead state machine's transactional invariants (history +
 * activity + audit, the one-open-callback rule, derived scheduling fields,
 * terminal cleanup), and customer erasure reaching lead surfaces.
 */

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;

const db = new PrismaClient({ datasourceUrl: TEST_URL ?? "postgresql://unused" });
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/org-context", () => ({
  scope: (c: { organisation: { id: string } }) => ({
    organisationId: c.organisation.id,
  }),
}));

const {
  createLead,
  listLeads,
  getLead,
  transitionLead,
  assignLead,
} = await import("@/lib/services/crm/leads");
const { eraseCustomer } = await import("@/lib/services/privacy");

type Role = "ADMIN" | "SUPERVISOR" | "OPERATOR" | "AUDITOR";

async function makeCtx(slug: string, role: Role = "ADMIN") {
  const organisation =
    (await db.organisation.findUnique({ where: { slug } })) ??
    (await db.organisation.create({ data: { name: slug, slug } }));
  const user = await db.user.create({
    data: {
      email: `${slug}-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: `${role} of ${slug}`,
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

beforeEach(() => {
  process.env.OPERANTO_CRM_ENABLED = "1";
});

afterAll(async () => {
  delete process.env.OPERANTO_CRM_ENABLED;
  await db.$disconnect();
});

describeDb("crm foundation", () => {
  it("refuses every entry point when the module flag is off", async () => {
    process.env.OPERANTO_CRM_ENABLED = "0";
    const ctx = await makeCtx("crm-flag");
    await expect(createLead(ctx, { fullName: "Flag Test" })).rejects.toThrow(/not enabled/);
    await expect(listLeads(ctx)).rejects.toThrow(/not enabled/);
  });

  it("keeps tenants isolated and operators record-scoped", async () => {
    const orgA = await makeCtx("crm-a");
    const orgB = await makeCtx("crm-b");
    const lead = await createLead(orgA, { fullName: "Tenant Test", phone: "+49 151 23456789" });

    expect(await getLead(orgB, lead.id)).toBeNull();
    await expect(transitionLead(orgB, lead.id, { to: "CONTACTED" })).rejects.toThrow(/not found/);

    const operatorA = await makeCtx("crm-a", "OPERATOR");
    expect((await listLeads(operatorA)).map((l) => l.id)).not.toContain(lead.id);
    await assignLead(orgA, lead.id, operatorA.membership.id);
    expect((await listLeads(operatorA)).map((l) => l.id)).toContain(lead.id);
  });

  it("enforces permissions per role", async () => {
    const operator = await makeCtx("crm-perms", "OPERATOR");
    const auditor = await makeCtx("crm-perms", "AUDITOR");
    const admin = await makeCtx("crm-perms");

    await expect(createLead(operator, { fullName: "Nope" })).rejects.toThrow(/crm.leads.create/);
    await expect(createLead(auditor, { fullName: "Nope" })).rejects.toThrow(/crm.leads.create/);

    const lead = await createLead(admin, { fullName: "Perm Test" });
    await expect(assignLead(operator, lead.id, null)).rejects.toThrow(/crm.leads.assign/);
    await expect(transitionLead(auditor, lead.id, { to: "CONTACTED" })).rejects.toThrow(
      /crm.leads.transition/,
    );
    // Auditor reads org-wide.
    expect((await listLeads(auditor)).map((l) => l.id)).toContain(lead.id);
  });

  it("runs the state machine with history, activity, audit and reason rules", async () => {
    const ctx = await makeCtx("crm-machine");
    const lead = await createLead(ctx, { fullName: "Machine Test" });

    await expect(transitionLead(ctx, lead.id, { to: "QUALIFIED" })).rejects.toThrow(
      /not allowed/,
    );
    await expect(transitionLead(ctx, lead.id, { to: "DO_NOT_CONTACT" })).rejects.toThrow(
      /requires a reason/,
    );

    await transitionLead(ctx, lead.id, { to: "CONTACTED" });
    const after = await getLead(ctx, lead.id);
    expect(after?.status).toBe("CONTACTED");
    expect(after?.statusHistory.map((h) => h.newStatus)).toEqual(["CONTACTED", "NEW"]);
    expect(
      after?.activities.some((a) => a.activityType === "crm.lead.status_changed"),
    ).toBe(true);
    const auditRow = await db.auditEvent.findFirst({
      where: {
        organisationId: ctx.organisation.id,
        eventType: "crm.lead.status_changed",
        targetId: lead.id,
      },
    });
    expect(auditRow).not.toBeNull();

    // DO_NOT_CONTACT with a reason sets the structural flag.
    await transitionLead(ctx, lead.id, { to: "CALLBACK", scheduledAt: future(1) });
    await transitionLead(ctx, lead.id, { to: "DO_NOT_CONTACT", reason: "asked us to stop" });
    const closed = await getLead(ctx, lead.id);
    expect(closed?.doNotCall).toBe(true);
  });

  it("upserts THE one open callback task and derives scheduling fields", async () => {
    const ctx = await makeCtx("crm-callback");
    const lead = await createLead(ctx, { fullName: "Callback Test" });
    await transitionLead(ctx, lead.id, { to: "CONTACTED" });

    await expect(
      transitionLead(ctx, lead.id, { to: "CALLBACK", scheduledAt: new Date(0) }),
    ).rejects.toThrow(/future date/);

    const first = future(2);
    await transitionLead(ctx, lead.id, { to: "CALLBACK", scheduledAt: first });
    let tasks = await db.task.findMany({
      where: { leadId: lead.id, type: "CALLBACK", status: "OPEN" },
    });
    expect(tasks).toHaveLength(1);
    expect((await getLead(ctx, lead.id))?.callbackAt?.getTime()).toBe(first.getTime());

    // Re-scheduling reuses the same task — never a second open callback.
    const second = future(4);
    await transitionLead(ctx, lead.id, { to: "CONTACTED" });
    await transitionLead(ctx, lead.id, { to: "CALLBACK", scheduledAt: second });
    tasks = await db.task.findMany({
      where: { leadId: lead.id, type: "CALLBACK", status: "OPEN" },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].dueAt?.getTime()).toBe(second.getTime());
    const synced = await getLead(ctx, lead.id);
    expect(synced?.callbackAt?.getTime()).toBe(second.getTime());
    expect(synced?.nextActionAt?.getTime()).toBe(second.getTime());

    // Terminal status cancels open lead work and clears derived fields.
    await transitionLead(ctx, lead.id, { to: "REJECTED", reason: "no interest" });
    const done = await getLead(ctx, lead.id);
    expect(done?.callbackAt).toBeNull();
    expect(done?.nextActionAt).toBeNull();
    expect(
      await db.task.count({ where: { leadId: lead.id, status: "OPEN" } }),
    ).toBe(0);
    expect(
      await db.task.count({ where: { leadId: lead.id, status: "CANCELLED" } }),
    ).toBe(1);
  });

  it("erasure reaches linked leads, their tasks and their timeline", async () => {
    const ctx = await makeCtx("crm-erasure");
    const customer = await db.customer.create({
      data: {
        organisationId: ctx.organisation.id,
        name: "Erase Me",
        email: "erase-me@example.com",
        emailNormalized: "erase-me@example.com",
      },
    });
    const lead = await createLead(ctx, {
      fullName: "Erase Me",
      phone: "+49 151 99887766",
      email: "erase-me@example.com",
    });
    await db.lead.update({ where: { id: lead.id }, data: { customerId: customer.id } });
    await transitionLead(ctx, lead.id, { to: "CONTACTED" });
    await transitionLead(ctx, lead.id, { to: "CALLBACK", scheduledAt: future(3) });

    const result = await eraseCustomer(ctx, customer.id, "GDPR request");
    expect(result.leads).toBe(1);

    const erased = await db.lead.findUnique({ where: { id: lead.id } });
    expect(erased?.fullName).toBe("[erased]");
    expect(erased?.phone).toBeNull();
    expect(erased?.phoneNormalized).toBeNull();
    expect(erased?.email).toBeNull();
    expect(erased?.doNotCall).toBe(true);
    const activities = await db.activity.findMany({ where: { leadId: lead.id } });
    expect(activities.every((a) => a.summary === "[erased]")).toBe(true);
    const task = await db.task.findFirst({ where: { leadId: lead.id } });
    expect(task?.title).toBe("[erased]");
  });
});

function future(hours: number): Date {
  return new Date(Date.now() + hours * 3_600_000);
}
