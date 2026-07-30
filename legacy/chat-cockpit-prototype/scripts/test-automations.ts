/**
 * Phase 7 integration check — automations rule engine + analyze hook.
 * Run: NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-automations.ts
 */
import { PrismaClient } from "@prisma/client";
import * as automations from "../src/lib/services/automations";
import * as ai from "../src/lib/services/ai-inbox";
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
  const agent = await ctxFor("bloom-studio", "driton@bloomstudio.test"); // no automations:manage
  const elira = await ctxFor("lumea-goods", "elira@lumeagoods.test");

  // Seed has 3 automations
  const list = await automations.listAutomations(owner);
  check("seed automations present", list.length >= 3);
  await expectThrow("agent cannot list automations (RBAC)", () => automations.listAutomations(agent));

  // Pick a pricing-tag automation and run it now across conversations
  const pricingAuto = list.find((a) => a.name === "Tag pricing inquiries");
  check("found 'Tag pricing inquiries'", !!pricingAuto);
  const pricingTag = await prisma.tag.findFirstOrThrow({
    where: { workspaceId: owner.workspace.id, name: "Pricing" },
  });
  const conv = await prisma.conversation.findFirstOrThrow({
    where: { workspaceId: owner.workspace.id, intent: "pricing_inquiry" },
  });
  // Remove the tag first so we can observe it being added.
  await prisma.conversationTag.deleteMany({ where: { conversationId: conv.id, tagId: pricingTag.id } });

  const affected = await automations.runAutomationNow(owner, pricingAuto!.id);
  check("run-now affected >=1 conversation", affected >= 1);
  const tagged = await prisma.conversationTag.findFirst({
    where: { conversationId: conv.id, tagId: pricingTag.id },
  });
  check("run-now applied the tag", !!tagged);

  // Idempotency: tag action upsert — running again does not duplicate
  await automations.runAutomationNow(owner, pricingAuto!.id);
  const tagCount = await prisma.conversationTag.count({
    where: { conversationId: conv.id, tagId: pricingTag.id },
  });
  check("tag not duplicated (idempotent)", tagCount === 1);

  // create_task idempotency via the analyze hook + hot-lead automation
  const hotConv = await prisma.conversation.findFirstOrThrow({
    where: { workspaceId: owner.workspace.id, leadScore: { gte: 80 } },
  });
  await prisma.task.deleteMany({
    where: { linkedConversationId: hotConv.id, title: "Follow up — hot lead" },
  });
  await ai.analyzeConversation(owner, hotConv.id); // sets leadScore + fires automations
  const tasksAfter1 = await prisma.task.count({
    where: { linkedConversationId: hotConv.id, title: "Follow up — hot lead" },
  });
  check("analyze hook created follow-up task for hot lead", tasksAfter1 === 1);
  await ai.analyzeConversation(owner, hotConv.id); // run again
  const tasksAfter2 = await prisma.task.count({
    where: { linkedConversationId: hotConv.id, title: "Follow up — hot lead" },
  });
  check("follow-up task not duplicated on re-analyze (idempotent)", tasksAfter2 === 1);

  // Tenant isolation: Lumea owner cannot run a Bloom automation
  await expectThrow("cross-tenant cannot run Bloom automation", () =>
    automations.runAutomationNow(elira, pricingAuto!.id),
  );

  // CRUD: create + toggle + delete
  const created = await automations.createAutomation(owner, {
    name: "Temp rule",
    trigger: "conversation_analyzed",
    conditions: [{ field: "sentiment", value: "angry" }],
    actions: [{ type: "set_priority", priority: "urgent" }],
  });
  check("create automation", !!created.id);
  await automations.setAutomationEnabled(owner, created.id, false);
  await automations.deleteAutomation(owner, created.id);
  const stillThere = await prisma.automation.findUnique({ where: { id: created.id } });
  check("delete automation", stillThere === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
