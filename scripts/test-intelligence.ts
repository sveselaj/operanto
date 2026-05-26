/**
 * Phase 6 integration check — analytics + AI manager insights.
 * Run: NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-intelligence.ts
 */
import { PrismaClient } from "@prisma/client";
import * as analytics from "../src/lib/services/analytics";
import type { WorkspaceContext } from "../src/lib/workspace";

const prisma = new PrismaClient();

async function ctxFor(slug: string, email: string): Promise<WorkspaceContext> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug } });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const member = await prisma.workspaceMember.findUniqueOrThrow({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
  });
  return { workspace, member, userId: user.id };
}

let pass = 0,
  fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  ok ? pass++ : fail++;
}
async function expectThrow(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false);
  } catch {
    check(name, true);
  }
}

async function main() {
  const owner = await ctxFor("bloom-studio", "lana@bloomstudio.test");
  const reviewer = await ctxFor("bloom-studio", "rina@bloomstudio.test"); // reports:view, no ai:run
  const elira = await ctxFor("lumea-goods", "elira@lumeagoods.test");

  const overview = await analytics.getOverview(owner);
  check("overview returns counts", typeof overview.openConversations === "number");
  check("overview includes overdue tasks", overview.overdueTasks >= 1); // seed has an overdue task

  const intents = await analytics.getIntentBreakdown(owner);
  check("intent breakdown non-empty", intents.length > 0);
  check("intents sorted desc", intents.every((v, i) => i === 0 || intents[i - 1].count >= v.count));

  const sentiment = await analytics.getSentimentBreakdown(owner);
  check("sentiment breakdown non-empty", sentiment.length > 0);

  const trend = await analytics.getVolumeTrend(owner, 14);
  check("volume trend has 14 buckets", trend.length === 14);

  const workload = await analytics.getAgentWorkload(owner);
  // owner + manager + agent are assignable; reviewer is excluded.
  check("Bloom workload has 3 assignable members", workload.length === 3);

  // Tenant scoping: Lumea has 2 assignable members
  const lumeaWorkload = await analytics.getAgentWorkload(elira);
  check("Lumea workload has 2 members (tenant scoped)", lumeaWorkload.length === 2);

  // Reviewer can view but not generate
  check("reviewer can view reports", (await analytics.getOverview(reviewer)).openConversations >= 0);
  await expectThrow("reviewer cannot generate insights (RBAC)", () =>
    analytics.generateManagerInsights(reviewer),
  );

  // Generate insights persists rows; re-running replaces (bounded)
  await analytics.generateManagerInsights(owner);
  const first = await prisma.insight.count({
    where: { workspaceId: owner.workspace.id, status: "open", sourceData: { path: ["generated"], equals: true } },
  });
  check("manager insights persisted", first > 0);
  await analytics.generateManagerInsights(owner);
  const second = await prisma.insight.count({
    where: { workspaceId: owner.workspace.id, status: "open", sourceData: { path: ["generated"], equals: true } },
  });
  check("re-running replaces (does not pile up)", second === first);

  // Tenant isolation: no generated insights leaked into Lumea
  const lumeaGenerated = await prisma.insight.count({
    where: { workspaceId: elira.workspace.id, sourceData: { path: ["generated"], equals: true } },
  });
  check("no generated insights leaked to other tenant", lumeaGenerated === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
