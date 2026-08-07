import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { deriveValidationReport } from "../src/lib/computer/validation-query";

/**
 * Computer C4.1 validation report (CLI).
 *
 * Prints the aggregated validation evidence for one organisation. It reads
 * ordinary Operanto domain state — no analytics store, no third-party
 * telemetry — so it works identically in Operanto Cloud, a private cloud,
 * or a customer-managed deployment.
 *
 * Output is ids, enums, counts and coarse buckets ONLY. No page text,
 * titles, URLs, element names, customer data, goals or model responses are
 * read or printed.
 *
 *   pnpm tsx scripts/computer-validation-report.ts --org <slug> \
 *     [--since 2026-08-01] [--until 2026-08-31] [--campaign c41-pilot-1]
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

function bar(label: string, value: number | string, width = 34): string {
  return `${label.padEnd(width, " ")} ${String(value)}`;
}

async function main() {
  const slug = arg("org");
  if (!slug) {
    console.error("Usage: --org <slug> [--since ISO] [--until ISO] [--campaign id]");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const organisation = await prisma.organisation.findUnique({ where: { slug } });
    if (!organisation) {
      console.error(`No organisation with slug "${slug}"`);
      process.exit(1);
    }
    const since = arg("since") ? new Date(arg("since")!) : undefined;
    const until = arg("until") ? new Date(arg("until")!) : undefined;
    const campaign = arg("campaign") ?? null;

    // Same derivation the cockpit uses — the server service is only a
    // thin RBAC wrapper over this, so there is no second definition of
    // any metric. Deployment-level DB access is the CLI's authority.
    const report = await deriveValidationReport(prisma, organisation.id, {
      since,
      until,
      campaign,
    });

    console.log(`\nComputer C4.1 validation — ${organisation.slug}`);
    if (campaign) console.log(`Campaign: ${campaign}`);
    if (since || until) {
      console.log(
        `Window: ${since?.toISOString() ?? "…"} → ${until?.toISOString() ?? "…"}`,
      );
    }
    console.log("\nRecommendations");
    console.log(bar("  total", report.recommendations.total));
    console.log(bar("  with bound target", report.recommendations.withBoundTarget));
    console.log(
      bar("  bound target rate", report.recommendations.boundTargetRate ?? "n/a"),
    );

    console.log("\nNavigations");
    const nav = report.navigations;
    for (const [label, value] of [
      ["proposed", nav.proposed],
      ["approved", nav.approved],
      ["rejected", nav.rejected],
      ["cancelled", nav.cancelled],
      ["claimed", nav.claimed],
      ["executed", nav.executed],
      ["VERIFIED", nav.verified],
      ["INCONCLUSIVE", nav.inconclusive],
      ["FAILED", nav.failed],
    ] as const) {
      console.log(bar(`  ${label}`, value));
    }
    console.log(bar("  approval agreement %", nav.approvalAgreementRate ?? "n/a"));
    console.log(bar("  verification %", nav.verificationRate ?? "n/a"));

    console.log("\nDurations (coarse buckets)");
    console.log(
      bar("  capture→recommendation", JSON.stringify(report.recommendations.captureToRecommendation)),
    );
    console.log(bar("  proposal→decision", JSON.stringify(nav.proposalToDecision)));
    console.log(bar("  approval→verification", JSON.stringify(nav.approvalToVerification)));

    console.log("\nFailures");
    const failures = Object.entries(report.failures).filter(([, count]) => count > 0);
    if (failures.length === 0) console.log("  (none)");
    for (const [reason, count] of failures) console.log(bar(`  ${reason}`, count));

    console.log("\nHuman usefulness");
    const assessments = Object.entries(report.assessments);
    for (const [key, count] of assessments) console.log(bar(`  ${key}`, count));

    console.log("\nPolicy");
    console.log(bar("  dropped link candidates", report.droppedLinkCount));

    console.log("\nInvariants (MUST all be 0)");
    for (const [key, count] of Object.entries(report.invariants)) {
      console.log(bar(`  ${key}`, `${count}${count === 0 ? "" : "  ← BREACH"}`));
    }
    const breached = Object.values(report.invariants).some((count) => count > 0);
    console.log(
      `\n${breached ? "INVARIANT BREACH — investigate before any C5 review." : "No invariant breaches."}\n`,
    );
    process.exitCode = breached ? 2 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
