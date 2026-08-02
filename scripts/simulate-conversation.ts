/**
 * Development/staging utility: ingest a deterministic simulated inbound
 * conversation message through the real service layer. NON-PRODUCTION — the
 * service refuses to run in production unless OPERANTO_SIMULATOR_ENABLED=1.
 *
 *   NODE_OPTIONS="--require ./scripts/preload.cjs" \
 *     pnpm tsx scripts/simulate-conversation.ts --scenario nagelista [--org <slug>]
 *
 * The preload neutralizes the `server-only` guard, exactly as the other
 * integration harnesses do. Scenarios are fixed and repeatable: re-running one
 * is an idempotent duplicate, not a second conversation.
 */
import "dotenv/config";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { ingestSimulatedMessage, SIMULATOR_SCENARIOS } = await import(
    "@/lib/services/conversation-simulator"
  );

  const scenarioKey = opt("--scenario") ?? "nagelista";
  if (!(scenarioKey in SIMULATOR_SCENARIOS)) {
    console.error(
      `Unknown scenario "${scenarioKey}". Available: ${Object.keys(SIMULATOR_SCENARIOS).join(", ")}`,
    );
    process.exit(1);
  }

  const slug = opt("--org");
  const organisation = slug
    ? await prisma.organisation.findUnique({ where: { slug } })
    : await prisma.organisation.findFirst({ orderBy: { createdAt: "asc" } });
  if (!organisation) {
    console.error(slug ? `No organisation with slug "${slug}"` : "No organisation found — seed first");
    process.exit(1);
  }

  const result = await ingestSimulatedMessage(
    organisation.id,
    scenarioKey as keyof typeof SIMULATOR_SCENARIOS,
    { runId: opt("--run") },
  );
  console.log(
    result.duplicate
      ? `Duplicate — scenario already ingested (conversation ${result.conversationId})`
      : `Ingested: conversation ${result.conversationId}, message ${result.messageId}, ` +
          `customer ${result.customerId ?? "not linked"}`,
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
