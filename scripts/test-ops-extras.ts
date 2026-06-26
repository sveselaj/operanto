/**
 * Phase F+G+H integration check — Appointments, Documents, Integration Hub.
 * Run: NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-ops-extras.ts
 */
import { PrismaClient } from "@prisma/client";
import * as opps from "../src/lib/services/opportunities";
import * as appts from "../src/lib/services/appointments";
import * as docs from "../src/lib/services/documents";
import * as integrations from "../src/lib/services/integrations";
import type { WorkspaceContext } from "../src/lib/workspace";

const prisma = new PrismaClient();
let pass = 0,
  fail = 0;
const check = (n: string, ok: boolean) => {
  console.log(`${ok ? "✓" : "✗"} ${n}`);
  ok ? pass++ : fail++;
};
async function expectThrow(n: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(n, false);
  } catch {
    check(n, true);
  }
}
async function ctxFor(slug: string, email: string): Promise<WorkspaceContext> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const member = await prisma.workspaceMember.findUniqueOrThrow({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
  });
  return { workspace, member, userId: user.id };
}

async function main() {
  const agent = await ctxFor("lumea-goods", "blerim@lumeagoods.test"); // appts + docs, NOT integrations
  const owner = await ctxFor("lumea-goods", "elira@lumeagoods.test"); // integrations:manage
  const customer = await prisma.customer.findFirstOrThrow({ where: { workspaceId: agent.workspace.id } });
  const opp = await opps.createOpportunity(agent, { customerId: customer.id, title: "Smoke: F/G/H" });

  // ── F: Appointments + ICS ──
  const appt = await appts.createAppointment(agent, {
    opportunityId: opp.id,
    type: "consultation",
    title: "Fitting",
    scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    durationMinutes: 45,
    location: "Studio",
  });
  check("appointment scheduled with a time becomes 'scheduled'", appt.status === "scheduled");
  const ics = await appts.appointmentIcs(agent, appt.id);
  check("ICS export contains a VEVENT for the appointment", ics.includes("BEGIN:VEVENT") && ics.includes("SUMMARY:Fitting"));
  check("appointment is listed on the opportunity", (await appts.listAppointments(agent, opp.id)).length === 1);

  // ── H: Documents — upload, extract (fills requirements), download ──
  const doc = await docs.createDocument(agent, {
    fileName: "window.png",
    mimeType: "image/png",
    bytes: Buffer.from("PNG-BYTES"),
    opportunityId: opp.id,
  });
  check("document kind inferred from mime (photo)", doc.kind === "photo");
  const ex = await docs.extractDocument(agent, doc.id);
  check("extraction produced fields", ex.fields > 0);
  const docRow = await prisma.document.findUniqueOrThrow({ where: { id: doc.id }, include: { extraction: true } });
  check("document marked extracted with an extraction row", docRow.status === "extracted" && docRow.extraction !== null);
  const filled = await prisma.customerRequirement.findMany({ where: { opportunityId: opp.id, status: "provided" } });
  check("extraction auto-filled requirements on the opportunity", filled.length > 0);
  const read = await docs.readDocument(agent, doc.id);
  check("document bytes are downloadable and intact", read.bytes.toString() === "PNG-BYTES");

  // ── G: Integration Hub — push (idempotent) + permission gate ──
  await expectThrow("agent cannot push to CRM (no integrations:manage)", () => integrations.pushOpportunityToCrm(agent, opp.id));
  const push1 = await integrations.pushOpportunityToCrm(owner, opp.id);
  check("CRM push succeeds (webhook simulated)", push1.status === "success" && push1.provider === "webhook");
  const push2 = await integrations.pushOpportunityToCrm(owner, opp.id);
  check("push is idempotent (same action, not re-run)", push2.id === push1.id && push2.attempts === push1.attempts);

  // Tenant isolation
  const bloom = await ctxFor("bloom-studio", "lana@bloomstudio.test");
  await expectThrow("cross-tenant appointment ICS is rejected", () => appts.appointmentIcs(bloom, appt.id));

  // ── Cleanup ──
  await docs.deleteDocument(agent, doc.id);
  await prisma.appointment.deleteMany({ where: { opportunityId: opp.id } });
  await prisma.integrationAction.deleteMany({ where: { entityId: opp.id } });
  await prisma.customerRequirement.deleteMany({ where: { opportunityId: opp.id } });
  await prisma.opportunity.delete({ where: { id: opp.id } });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
