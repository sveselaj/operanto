/**
 * Phase 5 integration check — Content Studio (brand voices + content + AI generate).
 * Run: NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-studio.ts
 */
import { PrismaClient } from "@prisma/client";
import * as content from "../src/lib/services/content";
import * as voices from "../src/lib/services/brand-voices";
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
  const reviewer = await ctxFor("bloom-studio", "rina@bloomstudio.test"); // no content:manage
  const elira = await ctxFor("lumea-goods", "elira@lumeagoods.test"); // other tenant

  // Brand voice
  const bv = await voices.createBrandVoice(owner, {
    name: "Test Voice",
    tone: "playful",
    dos: ["be warm"],
    donts: ["be pushy"],
    examplePhrases: ["hey!"],
  });
  check("create brand voice", !!bv.id);
  await expectThrow("reviewer cannot manage brand voices (RBAC)", () => voices.listBrandVoices(reviewer));

  // Manual content
  const draft = await content.createContent(owner, {
    title: "Manual post",
    channel: "instagram",
    content: "hello world",
    brandVoiceId: bv.id,
  });
  check("create content (idea)", draft.status === "idea");
  await content.updateContent(owner, draft.id, { status: "review" });
  const listed = await content.listContent(owner);
  check("content listed + status updated", listed.find((c) => c.id === draft.id)?.status === "review");

  await expectThrow("reviewer cannot create content (RBAC)", () =>
    content.createContent(reviewer, { title: "x", channel: "instagram", content: "y" }),
  );

  // AI generate from prompt
  const gen = await content.generateContentDraft(owner, {
    channel: "instagram",
    goal: "explain our pricing",
  });
  check("AI content generated as draft", gen.status === "draft");
  check("generated content has a body", gen.content.length > 0);

  // Generate from conversation
  const conv = await prisma.conversation.findFirstOrThrow({
    where: { workspaceId: owner.workspace.id, intent: "pricing_inquiry" },
  });
  const fromConv = await content.generateFromConversation(owner, conv.id, "instagram");
  check("generate from conversation links source", fromConv.sourceConversationId === conv.id);

  // Generate from insight
  const insight = await prisma.insight.findFirstOrThrow({
    where: { workspaceId: owner.workspace.id, type: "content_opportunity" },
  });
  const fromInsight = await content.generateFromInsight(owner, insight.id, "instagram");
  check("generate from insight links source", fromInsight.sourceInsightId === insight.id);

  // Tenant isolation
  const cross = await content.getContent(elira, draft.id);
  check("cross-tenant getContent returns null", cross === null);
  await expectThrow("cross-tenant cannot generate from Bloom conversation", () =>
    content.generateFromConversation(elira, conv.id, "instagram"),
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
