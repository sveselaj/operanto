/**
 * END-TO-END SLICE CHECK — the full "conversation → CRM" business process on a
 * SINGLE opportunity, in order, the way it would run for one real customer.
 *
 *   1 inquiry via MediaSync → 2 promote to Opportunity → 3 extract requirements
 *   → 4 show missing info → 5 draft the next question → 6 human sends it
 *   → 7 quote from catalogue → 8 manager approval → 9 survey appointment
 *   → 10 push contact + deal to CRM
 *
 * Uses a WINDOWS inquiry against the (jewelry) seed to also show the slice is
 * vertical-agnostic. AI is mock mode; CRM push is the simulated webhook provider.
 *
 * Run: NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-slice-e2e.ts
 */
import { PrismaClient } from "@prisma/client";
import { getConnector } from "../src/lib/channels";
import { ingestInbound } from "../src/lib/services/ingestion";
import * as opps from "../src/lib/services/opportunities";
import { extractRequirements, detectMissingInfo } from "../src/lib/services/ai-opportunities";
import * as convos from "../src/lib/services/conversations";
import * as quotes from "../src/lib/services/quotes";
import * as approvals from "../src/lib/services/approvals";
import * as appts from "../src/lib/services/appointments";
import * as integrations from "../src/lib/services/integrations";
import type { WorkspaceContext } from "../src/lib/workspace";

const prisma = new PrismaClient();
const num = (d: unknown) => (d == null ? 0 : Number((d as { toString(): string }).toString()));
let pass = 0,
  fail = 0;
const check = (n: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${n}${extra ? `  → ${extra}` : ""}`);
  ok ? pass++ : fail++;
};
const step = (n: number, title: string) => console.log(`\n[${n}] ${title}`);

async function ctxFor(slug: string, email: string): Promise<WorkspaceContext> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const member = await prisma.workspaceMember.findUniqueOrThrow({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
  });
  return { workspace, member, userId: user.id };
}

async function main() {
  const agent = await ctxFor("lumea-goods", "blerim@lumeagoods.test"); // NO approvals:decide
  const owner = await ctxFor("lumea-goods", "elira@lumeagoods.test"); // approvals:decide + integrations:manage
  const wsId = agent.workspace.id;
  const ext = `e2e_windows_${process.pid}`;

  // ── 1) Inquiry arrives through MediaSync ────────────────────────────────
  step(1, "Customer inquiry arrives through MediaSync (webchat)");
  const webchat = await prisma.channelAccount.findFirstOrThrow({
    where: { workspaceId: wsId, type: "webchat" },
  });
  const [normalized] = getConnector("webchat").normalizeWebhook({
    channelAccountId: webchat.id,
    customer: { name: "Familie Weber", externalId: ext },
    body: "Hallo, wir brauchen 5 neue Fenster für unser Haus, Dreifachverglasung, bis September. Können Sie ein Angebot machen?",
  });
  const ingest = await ingestInbound(normalized);
  check("inbound message created a conversation", ingest.created === true);
  check("a customer was resolved/created", !!ingest.customerId);
  const convId = ingest.conversationId;

  // ── 2) Promote to Opportunity ──────────────────────────────────────────
  step(2, "Promote conversation to an Opportunity");
  const promo = await opps.promoteConversation(agent, convId);
  check("promote created an opportunity", promo.created === true);
  const oppId = promo.opportunityId;
  const linked = await prisma.conversation.findUniqueOrThrow({ where: { id: convId } });
  check("conversation is linked to the opportunity", linked.opportunityId === oppId);

  // ── 3) Extract structured requirements ─────────────────────────────────
  step(3, "Extract structured requirements (AI, mock mode)");
  const ex = await extractRequirements(agent, oppId);
  const reqs = await prisma.customerRequirement.findMany({ where: { opportunityId: oppId } });
  check("extraction produced requirements", ex.count > 0, `${ex.count} extracted`);
  check("requirements persisted on the opportunity", reqs.length === ex.count);

  // ── 4) Show what information is missing ─────────────────────────────────
  step(4, "Detect missing information");
  const miss = await detectMissingInfo(agent, oppId);
  check(
    "missing-info reported with labels",
    miss.complete === false && miss.missingLabels.length > 0,
    `missing: ${miss.missingLabels.join(", ")}`,
  );

  // ── 5) Draft the next question ──────────────────────────────────────────
  step(5, "Draft the next question to the customer");
  check("a question was drafted (not sent automatically)", typeof miss.message === "string" && (miss.message?.length ?? 0) > 0);
  console.log(`      draft: "${(miss.message ?? "").slice(0, 90)}…"`);

  // ── 6) Human reviews + sends the draft ─────────────────────────────────
  step(6, "Human agent reviews and sends the message");
  const sent = await convos.sendReply(agent, convId, miss.message ?? "Could you share more details?");
  check("outbound message recorded", sent.direction === "outbound" && !!sent.id);
  const convAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: convId } });
  check("conversation flipped to human handling on send", convAfter.handling === "human");

  // Customer answers → fill the still-missing required facts (simulating their reply).
  for (const r of reqs.filter((x) => x.required && x.status !== "provided")) {
    await opps.setRequirementValue(agent, r.id, "provided-by-customer");
  }
  const miss2 = await detectMissingInfo(agent, oppId);
  check("once facts are provided, opportunity is qualified", miss2.complete === true);

  // ── 7) Generate a quote from the catalogue ─────────────────────────────
  step(7, "Draft a quote from the catalogue");
  const draft = await quotes.draftQuote(agent, oppId);
  const full = await quotes.getQuote(agent, draft.id);
  check("quote drafted with at least one line", (full?.lines.length ?? 0) >= 1, `${full?.lines.length} line(s)`);
  check("quote total computed", num(full?.total) > 0, `total ${num(full?.total)} ${full?.currency}`);
  const quoteTotal = num(full?.total);

  // ── 8) Manager approval to send the quote ──────────────────────────────
  step(8, "Manager approval gate on sending the quote");
  const trySend = await quotes.requestQuoteSend(agent, draft.id);
  check("agent send is gated (not sent directly)", trySend.sent === false);
  const pending = await approvals.pendingApproval(agent, "Quote", draft.id, "quote.send");
  check("a pending approval was filed", !!pending);
  let qRow = await prisma.quote.findUniqueOrThrow({ where: { id: draft.id } });
  check("quote is NOT sent while pending", qRow.status !== "sent");
  await approvals.decideApproval(owner, pending!.id, "approved");
  qRow = await prisma.quote.findUniqueOrThrow({ where: { id: draft.id } });
  check("manager approval applied the effect — quote sent", qRow.status === "sent" && qRow.sentAt !== null);

  // ── 9) Create a survey (site-measurement) appointment ──────────────────
  step(9, "Schedule a survey appointment (Aufmaß)");
  const appt = await appts.createAppointment(agent, {
    opportunityId: oppId,
    type: "survey",
    title: "Aufmaß / site measurement",
    scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    durationMinutes: 60,
    location: "Customer home",
  });
  check("survey appointment scheduled", appt.type === "survey" && appt.status === "scheduled");
  const ics = await appts.appointmentIcs(agent, appt.id);
  check("appointment exports as a calendar invite (ICS)", ics.includes("BEGIN:VEVENT"));

  // ── 10) Push contact + deal to CRM ─────────────────────────────────────
  step(10, "Push contact + deal to the CRM (simulated HubSpot/webhook)");
  // Mark won + carry the quote total onto the opportunity so the deal has a value.
  await opps.updateOpportunity(owner, oppId, { status: "won", value: quoteTotal });
  const push = await integrations.pushOpportunityToCrm(owner, oppId);
  check("CRM push succeeded", push.status === "success", `provider: ${push.provider}`);
  const dealAmount = (push.request as { deal?: { amount?: number } } | null)?.deal?.amount;
  check("deal carries the quote amount", dealAmount === quoteTotal, `deal.amount = ${dealAmount}`);
  const push2 = await integrations.pushOpportunityToCrm(owner, oppId);
  check("push is idempotent (same action id, no re-run)", push2.id === push.id && push2.attempts === push.attempts);

  // ── Audit trail — the whole journey is traceable ────────────────────────
  // Each service audits against its OWN entity id (integration.run → action id,
  // approval.* → request id), so gather all the relevant entity ids.
  step(0, "Audit trail for this opportunity");
  const auditEntityIds = [oppId, draft.id, appt.id, convId, sent.id, pending!.id, push.id];
  const trail = await prisma.auditLog.findMany({
    where: { workspaceId: wsId, entityId: { in: auditEntityIds } },
    orderBy: { createdAt: "asc" },
    select: { action: true },
  });
  const actions = trail.map((t) => t.action);
  console.log(`      ${actions.join("  →  ")}`);
  check(
    "audit covers promote, extract, quote, approval, appointment, integration",
    ["opportunity.promote", "opportunity.extract", "quote.draft", "approval.decide", "appointment.create", "integration.run"].every(
      (a) => actions.includes(a),
    ),
  );

  // ── Cleanup (idempotent re-runs) ────────────────────────────────────────
  await prisma.auditLog.deleteMany({ where: { workspaceId: wsId, entityId: { in: auditEntityIds } } });
  await prisma.integrationAction.deleteMany({ where: { entityId: oppId } });
  await prisma.appointment.deleteMany({ where: { opportunityId: oppId } });
  await prisma.approvalRequest.deleteMany({ where: { entityId: draft.id } });
  await prisma.quoteLine.deleteMany({ where: { quoteId: draft.id } });
  await prisma.quote.deleteMany({ where: { id: draft.id } });
  await prisma.customerRequirement.deleteMany({ where: { opportunityId: oppId } });
  await prisma.message.deleteMany({ where: { conversationId: convId } });
  await prisma.conversationTag.deleteMany({ where: { conversationId: convId } });
  await prisma.opportunity.update({ where: { id: oppId }, data: { primaryConversationId: null } });
  await prisma.conversation.update({ where: { id: convId }, data: { opportunityId: null } });
  await prisma.conversation.delete({ where: { id: convId } });
  await prisma.opportunity.delete({ where: { id: oppId } });
  await prisma.customer.deleteMany({ where: { workspaceId: wsId, socialHandles: { path: ["externalId"], equals: ext } } });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
