/**
 * Phase 2 integration check — runs the conversation service directly against the
 * dev DB to verify mutations, audit logging, RBAC, and tenant isolation.
 * Run with: pnpm tsx scripts/test-inbox.ts
 */
import { PrismaClient } from "@prisma/client";
import * as svc from "../src/lib/services/conversations";
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

let pass = 0;
let fail = 0;
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
  const reviewer = await ctxFor("bloom-studio", "rina@bloomstudio.test"); // reviewer (read-only-ish)
  const elira = await ctxFor("lumea-goods", "elira@lumeagoods.test"); // other tenant owner

  const list = await svc.listConversations(owner, { status: "open" });
  check("owner lists open conversations", list.length > 0);
  const conv = list[0];

  // Reply
  const auditBefore = await prisma.auditLog.count({ where: { workspaceId: owner.workspace.id } });
  await svc.sendReply(owner, conv.id, "Test reply from integration check");
  const full = await svc.getConversation(owner, conv.id);
  check(
    "reply persisted as outbound message",
    !!full?.messages.some((m) => m.body === "Test reply from integration check" && m.direction === "outbound"),
  );

  // Status + priority + note + tags
  await svc.updateStatus(owner, conv.id, "pending");
  await svc.updatePriority(owner, conv.id, "urgent");
  await svc.addNote(owner, conv.id, "Integration note");
  const tags = await svc.listWorkspaceTags(owner);
  await svc.setTags(owner, conv.id, [tags[0].id]);
  const after = await svc.getConversation(owner, conv.id);
  check("status updated", after?.status === "pending");
  check("priority updated", after?.priority === "urgent");
  check("note added", !!after?.internalNotes.some((n) => n.body === "Integration note"));
  check("tag applied", after?.tags.length === 1 && after.tags[0].tagId === tags[0].id);

  const auditAfter = await prisma.auditLog.count({ where: { workspaceId: owner.workspace.id } });
  check("audit rows written for mutations", auditAfter > auditBefore);

  // RBAC: reviewer cannot reply or triage
  await expectThrow("reviewer cannot reply (RBAC)", () =>
    svc.sendReply(reviewer, conv.id, "should fail"),
  );
  await expectThrow("reviewer cannot change status (RBAC)", () =>
    svc.updateStatus(reviewer, conv.id, "resolved"),
  );
  check("reviewer CAN read", (await svc.listConversations(reviewer, {})).length > 0);

  // Tenant isolation: Lumea owner cannot see/mutate a Bloom conversation
  const crossRead = await svc.getConversation(elira, conv.id);
  check("cross-tenant getConversation returns null", crossRead === null);
  await expectThrow("cross-tenant reply rejected", () =>
    svc.sendReply(elira, conv.id, "cross tenant"),
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
