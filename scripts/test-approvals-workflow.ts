/**
 * Phase D+E integration check — Approvals gate + Workflow engine.
 * Run: NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-approvals-workflow.ts
 */
import { PrismaClient } from "@prisma/client";
import * as opps from "../src/lib/services/opportunities";
import * as quotes from "../src/lib/services/quotes";
import * as approvals from "../src/lib/services/approvals";
import * as workflow from "../src/lib/services/workflow";
import type { WorkspaceContext } from "../src/lib/workspace";

const prisma = new PrismaClient();
const num = (d: unknown) => (d == null ? 0 : Number((d as { toString(): string }).toString()));
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
  const agent = await ctxFor("lumea-goods", "blerim@lumeagoods.test"); // quotes+workflow, NOT approvals:decide
  const owner = await ctxFor("lumea-goods", "elira@lumeagoods.test"); // approvals:decide
  const customer = await prisma.customer.findFirstOrThrow({ where: { workspaceId: agent.workspace.id } });

  // Fresh opportunity for this test.
  const opp = await opps.createOpportunity(agent, { customerId: customer.id, title: "Smoke: approvals+workflow" });

  // ── Workflow ──
  for (const r of [
    { key: "item_type", label: "Item", valueType: "text", value: "Bracelet" },
    { key: "material", label: "Material", valueType: "text", value: "Silver" },
    { key: "deadline", label: "Needed by", valueType: "date", value: "Next week" },
    { key: "personalization_text", label: "Name to engrave", valueType: "text", value: null }, // missing
  ]) {
    await opps.upsertRequirement(agent, opp.id, r);
  }

  await workflow.startWorkflow(agent, opp.id);
  let view = await workflow.getWorkflowForOpportunity(agent, opp.id);
  check("workflow starts at the first step", view?.currentStepName === "Collect requirements");
  check("workflow is blocked by the missing requirement", view?.canAdvance === false && view!.missingLabels.includes("Name to engrave"));
  await expectThrow("advance throws while blocked", () => workflow.advanceWorkflow(agent, opp.id));

  // Provide the missing fact → unblocks.
  const personalization = await prisma.customerRequirement.findFirstOrThrow({ where: { opportunityId: opp.id, key: "personalization_text" } });
  await opps.setRequirementValue(agent, personalization.id, "TEUTA");
  view = await workflow.getWorkflowForOpportunity(agent, opp.id);
  check("workflow unblocks once the fact is provided", view?.canAdvance === true);

  await workflow.advanceWorkflow(agent, opp.id);
  view = await workflow.getWorkflowForOpportunity(agent, opp.id);
  check("workflow advanced to the next step", view?.currentStepName === "Prepare & send quote");
  await workflow.advanceWorkflow(agent, opp.id); // → await_decision
  await workflow.advanceWorkflow(agent, opp.id); // → won
  await workflow.advanceWorkflow(agent, opp.id); // complete
  view = await workflow.getWorkflowForOpportunity(agent, opp.id);
  check("workflow completes after the last step", view?.status === "completed");

  // ── Approvals: quote send gate ──
  const q = await quotes.createQuote(agent, opp.id);
  await quotes.addLine(agent, q.id, { description: "Bracelet", quantity: 1, unitPrice: 100, taxRate: 0 });
  const send1 = await quotes.requestQuoteSend(agent, q.id);
  check("agent send is gated (not sent immediately)", send1.sent === false);
  const pendingSend = await approvals.pendingApproval(agent, "Quote", q.id, "quote.send");
  check("a pending send approval was created", !!pendingSend);
  let qRow = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
  check("quote is not sent while pending", qRow.status !== "sent");

  await expectThrow("agent cannot decide approvals", () => approvals.decideApproval(agent, pendingSend!.id, "approved"));
  await approvals.decideApproval(owner, pendingSend!.id, "approved");
  qRow = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
  check("approval applied the effect — quote is sent", qRow.status === "sent" && qRow.sentAt !== null);

  // ── Approvals: price override ──
  const totalBefore = num((await quotes.getQuote(agent, q.id))!.total);
  await quotes.requestPriceOverride(agent, q.id, { label: "Loyalty discount", amount: -10, reason: "repeat buyer" });
  const pendingOverride = await approvals.pendingApproval(agent, "Quote", q.id, "price.override");
  check("a pending price-override approval was created", !!pendingOverride);
  await approvals.decideApproval(owner, pendingOverride!.id, "approved");
  const totalAfter = num((await quotes.getQuote(agent, q.id))!.total);
  check("approved override added a discount line (total dropped by 10)", totalAfter === totalBefore - 10);

  // Owner sends directly (no gate).
  const q2 = await quotes.createQuote(owner, opp.id);
  await quotes.addLine(owner, q2.id, { description: "Charm", quantity: 1, unitPrice: 20, taxRate: 0 });
  const send2 = await quotes.requestQuoteSend(owner, q2.id);
  check("a decider sends directly (no gate)", send2.sent === true);

  // Tenant isolation
  const bloom = await ctxFor("bloom-studio", "lana@bloomstudio.test");
  await expectThrow("cross-tenant decide is rejected", () => approvals.decideApproval(bloom, pendingSend!.id, "approved"));

  // ── Cleanup ──
  const createdQuotes = [q.id, q2.id];
  await prisma.approvalRequest.deleteMany({ where: { entityId: { in: createdQuotes } } });
  await prisma.quoteLine.deleteMany({ where: { quoteId: { in: createdQuotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: createdQuotes } } });
  await prisma.workflowTransition.deleteMany({ where: { instance: { opportunityId: opp.id } } });
  await prisma.workflowInstance.deleteMany({ where: { opportunityId: opp.id } });
  await prisma.customerRequirement.deleteMany({ where: { opportunityId: opp.id } });
  await prisma.opportunity.delete({ where: { id: opp.id } });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
