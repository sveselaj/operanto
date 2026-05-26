/**
 * Phase 8 integration check — channel ingestion + connectors.
 * Run: NODE_OPTIONS="--require ./scripts/preload.cjs" pnpm tsx scripts/test-ingestion.ts
 */
import { PrismaClient } from "@prisma/client";
import { ingestInbound } from "../src/lib/services/ingestion";
import { getConnector, isChannelType } from "../src/lib/channels";

const prisma = new PrismaClient();

let pass = 0,
  fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  ok ? pass++ : fail++;
}
function expectThrowSync(name: string, fn: () => unknown) {
  try {
    fn();
    check(name, false);
  } catch {
    check(name, true);
  }
}

async function main() {
  const bloom = await prisma.workspace.findUniqueOrThrow({ where: { slug: "bloom-studio" } });
  const webchat = await prisma.channelAccount.findFirstOrThrow({
    where: { workspaceId: bloom.id, type: "webchat" },
  });
  const pricingTag = await prisma.tag.findFirstOrThrow({
    where: { workspaceId: bloom.id, name: "Pricing" },
  });

  // Connector registry + normalize
  check("webchat is a valid channel type", isChannelType("webchat"));
  check("unknown channel rejected", !isChannelType("carrier-pigeon"));
  const connector = getConnector("webchat");
  check("webchat connector accepts (verifySignature true)", connector.verifySignature(new Headers(), ""));
  check("provider stub rejects signature", !getConnector("instagram").verifySignature(new Headers(), ""));
  expectThrowSync("provider stub normalize throws", () => getConnector("whatsapp").normalizeWebhook({}));
  expectThrowSync("webchat normalize requires body", () =>
    connector.normalizeWebhook({ channelAccountId: webchat.id }),
  );

  const normalized = connector.normalizeWebhook({
    channelAccountId: webchat.id,
    customer: { name: "Web Visitor", externalId: "web_test_123" },
    body: "Hi, what is the price for a hydrafacial?",
  });
  check("normalize produces channelAccountId + body", normalized.channelAccountId === webchat.id);

  // First ingest → creates conversation + customer + fires inbound_message automation
  const r1 = await ingestInbound(normalized);
  check("first ingest creates a conversation", r1.created === true);

  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: r1.conversationId },
    include: { messages: true, tags: true, customer: true },
  });
  check("conversation is inbound webchat", conv.channelType === "webchat");
  check("message persisted", conv.messages.some((m) => m.direction === "inbound"));
  check("customer created with given name", conv.customer?.name === "Web Visitor");
  check(
    "inbound_message automation tagged Pricing ('price' in body)",
    conv.tags.some((t) => t.tagId === pricingTag.id),
  );

  // Second message from same visitor → same open conversation (no duplicate)
  const r2 = await ingestInbound(
    connector.normalizeWebhook({
      channelAccountId: webchat.id,
      customer: { name: "Web Visitor", externalId: "web_test_123" },
      body: "Still there?",
    }),
  );
  check("second message reuses the open conversation", r2.conversationId === r1.conversationId);
  check("same customer reused", r2.customerId === r1.customerId);

  // Unknown channel account rejected
  let threw = false;
  try {
    await ingestInbound({ channelAccountId: "does-not-exist", customer: {}, body: "x" });
  } catch {
    threw = true;
  }
  check("unknown channel account rejected", threw);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().finally(() => prisma.$disconnect());
