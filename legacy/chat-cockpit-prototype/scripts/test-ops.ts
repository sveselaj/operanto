/**
 * Phase 4 integration check — tasks + SOPs services.
 * Run: NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-ops.ts
 */
import { PrismaClient } from "@prisma/client";
import * as tasks from "../src/lib/services/tasks";
import * as sops from "../src/lib/services/sops";
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
  const owner = await ctxFor("bloom-studio", "lana@bloomstudio.test"); // owner
  const agent = await ctxFor("bloom-studio", "driton@bloomstudio.test"); // agent
  const reviewer = await ctxFor("bloom-studio", "rina@bloomstudio.test"); // reviewer
  const elira = await ctxFor("lumea-goods", "elira@lumeagoods.test"); // other tenant

  // ── Tasks ──
  const conv = await prisma.conversation.findFirstOrThrow({
    where: { workspaceId: owner.workspace.id },
  });
  const task = await tasks.createTask(owner, {
    title: "Integration task",
    priority: "high",
    assignedToUserId: agent.userId,
    linkedConversationId: conv.id,
  });
  check("create task", !!task.id);

  await tasks.updateTask(owner, task.id, { status: "in_progress" });
  const listed = await tasks.listTasks(agent, { assignee: "me" });
  check("agent sees task assigned to them", listed.some((t) => t.id === task.id));
  check("task status updated", listed.find((t) => t.id === task.id)?.status === "in_progress");

  await expectThrow("reviewer cannot manage tasks (RBAC)", () => tasks.listTasks(reviewer));
  await expectThrow("cross-tenant cannot create task on Bloom conv", () =>
    tasks.createTask(elira, { title: "x", linkedConversationId: conv.id }),
  );

  // ── SOPs ──
  const sop = await sops.createSOP(owner, { title: "Test SOP", body: "Body v1" });
  check("create SOP (draft)", sop.status === "draft");

  await expectThrow("agent cannot create SOP (RBAC)", () =>
    sops.createSOP(agent, { title: "nope", body: "x" }),
  );

  // Approve requires sops:approve (owner has it; manager creates but cannot approve)
  const manager = await ctxFor("bloom-studio", "marko@bloomstudio.test");
  await expectThrow("manager cannot approve SOP (RBAC)", () =>
    sops.setSOPStatus(manager, sop.id, "approved"),
  );
  const approved = await sops.setSOPStatus(owner, sop.id, "approved");
  check("owner approves SOP", approved.status === "approved");

  // Editing an approved SOP body returns to draft + bumps version
  const reopened = await sops.updateSOP(owner, sop.id, { body: "Body v2" });
  check("editing approved SOP returns to draft", reopened.status === "draft");
  check("version bumped", reopened.version === sop.version + 1);

  // AI generate (mock mode)
  const gen = await sops.generateSOPDraft(owner, { topic: "handling late deliveries" });
  check("AI-generated SOP created as draft", gen.status === "draft");
  check("generated SOP has a formatted body", gen.body.includes("## Steps"));

  // Tenant isolation
  const cross = await sops.getSOP(elira, sop.id);
  check("cross-tenant getSOP returns null", cross === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
