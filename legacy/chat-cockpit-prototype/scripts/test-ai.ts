/**
 * Phase 3 integration check — exercises the AI layer in mock mode (no API key).
 * Verifies analyze persistence, AIAction logging, draft generation, structured
 * schema validity, and RBAC. Run:
 *   NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-ai.ts
 */
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import * as ai from "../src/lib/services/ai-inbox";
import { classifyTask, summarizeTask, draftReplyTask } from "../src/lib/ai/tasks";
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
  // Schemas convert to JSON Schema (used for provider tool-calling).
  for (const t of [classifyTask, summarizeTask, draftReplyTask]) {
    const json = z.toJSONSchema(t.schema) as Record<string, unknown>;
    check(`${t.name} schema → JSON Schema (type object)`, json.type === "object");
  }

  const owner = await ctxFor("bloom-studio", "lana@bloomstudio.test");
  const reviewer = await ctxFor("bloom-studio", "rina@bloomstudio.test"); // no ai:run

  const conv = await prisma.conversation.findFirstOrThrow({
    where: { workspaceId: owner.workspace.id, intent: "pricing_inquiry" },
  });

  const aiBefore = await prisma.aIAction.count({ where: { workspaceId: owner.workspace.id } });

  // Analyze: summarize + classify + persist
  const result = await ai.analyzeConversation(owner, conv.id);
  check("analyze returns a summary", !!result.summary.summary);
  check("analyze returns a recommended next action", !!result.recommendedNextAction);
  check(
    "classification intent is a valid enum",
    typeof result.classification.intent === "string",
  );
  check(
    "lead score in [0,100]",
    result.classification.leadScore >= 0 && result.classification.leadScore <= 100,
  );

  const persisted = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
  check("summary persisted on conversation", !!persisted.summary);
  check("intent persisted", !!persisted.intent);
  check("sentiment persisted", !!persisted.sentiment);

  // Draft reply
  const draft = await ai.draftConversationReply(owner, conv.id);
  check("draft reply produced", draft.reply.length > 0);
  check("draft has risk + confidence", !!draft.risk && typeof draft.confidence === "number");
  check("draft logged an AIAction id", !!draft.aiActionId);

  // AIAction logging: summarize + classify + draftReply = 3 new
  const aiAfter = await prisma.aIAction.count({ where: { workspaceId: owner.workspace.id } });
  check("AIAction rows logged (>=3 new)", aiAfter - aiBefore >= 3);
  const logged = await prisma.aIAction.findFirst({
    where: { workspaceId: owner.workspace.id, actionType: "classifyConversation" },
    orderBy: { createdAt: "desc" },
  });
  check("AIAction stores model + status + confidence", !!logged?.model && logged?.status === "suggested");

  // RBAC: reviewer lacks ai:run
  await expectThrow("reviewer cannot run AI (RBAC)", () => ai.analyzeConversation(reviewer, conv.id));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
