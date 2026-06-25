/**
 * Phase A integration check — Lead Engine (Opportunity + Requirements + AI).
 * Run: NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-opportunities.ts
 */
import { PrismaClient } from "@prisma/client";
import * as opps from "../src/lib/services/opportunities";
import { extractRequirements, detectMissingInfo } from "../src/lib/services/ai-opportunities";
import { requirementProgress } from "../src/lib/opportunity-progress";
import type { WorkspaceContext } from "../src/lib/workspace";

const prisma = new PrismaClient();
let pass = 0,
  fail = 0;
const check = (n: string, ok: boolean) => {
  console.log(`${ok ? "✓" : "✗"} ${n}`);
  ok ? pass++ : fail++;
};

async function ctxFor(slug: string, email: string): Promise<WorkspaceContext> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const member = await prisma.workspaceMember.findUniqueOrThrow({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
  });
  return { workspace, member, userId: user.id };
}

async function main() {
  const ctx = await ctxFor("lumea-goods", "blerim@lumeagoods.test"); // agent

  // A conversation with a customer but no opportunity yet (Bekim — shipping).
  const conv = await prisma.conversation.findFirstOrThrow({
    where: { workspaceId: ctx.workspace.id, opportunityId: null, customerId: { not: null } },
  });

  const r1 = await opps.promoteConversation(ctx, conv.id);
  check("promote creates an opportunity", r1.created === true);
  const oppId = r1.opportunityId;
  const linked = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
  check("conversation is linked to the opportunity", linked.opportunityId === oppId);

  const r2 = await opps.promoteConversation(ctx, conv.id);
  check("promote is idempotent", r2.created === false && r2.opportunityId === oppId);

  const ex = await extractRequirements(ctx, oppId); // mock mode — no API key needed
  check("extraction produced requirements", ex.count > 0);
  const reqs1 = await prisma.customerRequirement.findMany({ where: { opportunityId: oppId } });
  check("requirements persisted", reqs1.length === ex.count);

  const miss = await detectMissingInfo(ctx, oppId);
  check("missing-info detected", miss.complete === false && miss.missingLabels.length > 0);
  check("a request message was drafted", typeof miss.message === "string" && (miss.message?.length ?? 0) > 0);

  for (const r of reqs1.filter((x) => x.required && x.status !== "provided")) {
    await opps.setRequirementValue(ctx, r.id, "provided-by-test");
  }
  const reqs2 = await prisma.customerRequirement.findMany({
    where: { opportunityId: oppId },
    select: { label: true, status: true, required: true },
  });
  check("all required facts now provided", requirementProgress(reqs2).complete === true);
  const miss2 = await detectMissingInfo(ctx, oppId);
  check("detect now reports complete", miss2.complete === true);

  // Tenant isolation — a Bloom member cannot read a Lumea opportunity.
  const bloom = await ctxFor("bloom-studio", "lana@bloomstudio.test");
  check("cross-tenant getOpportunity returns null", (await opps.getOpportunity(bloom, oppId)) === null);

  // Cleanup so re-runs stay idempotent.
  await prisma.customerRequirement.deleteMany({ where: { opportunityId: oppId } });
  await prisma.conversation.update({ where: { id: conv.id }, data: { opportunityId: null } });
  await prisma.opportunity.delete({ where: { id: oppId } });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
