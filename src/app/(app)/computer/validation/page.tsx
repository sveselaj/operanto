import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/org-context";
import {
  buildComputerValidationReport,
  listValidationRuns,
} from "@/lib/services/computer-validation";
import { computerValidationCampaign } from "@/lib/computer-flag";
import { PageHeader } from "@/components/app/page-header";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Computer validation" };

/**
 * Computer C4.1 validation view — internal evidence, not a customer
 * analytics product. It shows ids, enums, counts and rates only: no page
 * text, titles, URLs, element names, customer data, goals or model
 * responses can reach this surface. It lives under the existing /computer
 * gate (navigation flag + `computer:read`) and adds no navigation entry.
 */
export default async function ComputerValidationPage() {
  const ctx = await requireOrg();
  const [report, runs] = await Promise.all([
    buildComputerValidationReport(ctx, { campaign: computerValidationCampaign() }),
    listValidationRuns(ctx),
  ]);
  const nav = report.navigations;
  const breached = Object.values(report.invariants).some((count) => count > 0);

  const stats: [string, string | number][] = [
    ["Recommendations", report.recommendations.total],
    ["…with bound target", report.recommendations.withBoundTarget],
    ["Navigations proposed", nav.proposed],
    ["Approved", nav.approved],
    ["Rejected", nav.rejected],
    ["Executed", nav.executed],
    ["VERIFIED", nav.verified],
    ["INCONCLUSIVE", nav.inconclusive],
    ["FAILED", nav.failed],
    ["Dropped link candidates", report.droppedLinkCount],
  ];

  return (
    <>
      <PageHeader
        title="Computer validation"
        description="C4.1 evidence for the single-navigation primitive. Operational state only — no page content is recorded or shown."
      >
        <Link href="/computer" className="text-sm underline">
          Sessions
        </Link>
      </PageHeader>

      {report.campaign ? (
        <p className="mb-4 text-xs text-muted-foreground">
          Campaign: <code className="rounded bg-muted px-1">{report.campaign}</code>
        </p>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-md border px-3 py-2">
            <div className="text-lg font-semibold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-2">
        <div className="rounded-md border p-3 text-sm">
          <h2 className="mb-1 font-semibold">Rates</h2>
          <p>
            Bound target:{" "}
            {report.recommendations.boundTargetRate === null
              ? "n/a"
              : `${report.recommendations.boundTargetRate}%`}
          </p>
          <p>
            Approval agreement:{" "}
            {nav.approvalAgreementRate === null ? "n/a" : `${nav.approvalAgreementRate}%`}
          </p>
          <p>
            Verification:{" "}
            {nav.verificationRate === null ? "n/a" : `${nav.verificationRate}%`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Rates read “n/a” rather than 0% when there is no underlying data.
          </p>
        </div>
        <div
          className={
            breached
              ? "rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
              : "rounded-md border p-3 text-sm"
          }
        >
          <h2 className="mb-1 font-semibold">Invariants (must be 0)</h2>
          {Object.entries(report.invariants).map(([key, count]) => (
            <p key={key}>
              {key}: <strong>{count}</strong>
              {count > 0 ? " ← BREACH" : ""}
            </p>
          ))}
        </div>
      </div>

      <h2 className="mb-2 text-sm font-semibold">Failures</h2>
      <ul className="mb-6 flex flex-wrap gap-2 text-xs">
        {Object.entries(report.failures)
          .filter(([, count]) => count > 0)
          .map(([reason, count]) => (
            <li key={reason} className="rounded bg-muted px-2 py-1">
              {reason}: {count}
            </li>
          ))}
        {Object.values(report.failures).every((count) => count === 0) ? (
          <li className="text-muted-foreground">None recorded.</li>
        ) : null}
      </ul>

      <h2 className="mb-2 text-sm font-semibold">Human usefulness</h2>
      <ul className="mb-6 flex flex-wrap gap-2 text-xs">
        {Object.entries(report.assessments).map(([key, count]) => (
          <li key={key} className="rounded bg-muted px-2 py-1">
            {key}: {count}
          </li>
        ))}
      </ul>

      <h2 className="mb-2 text-sm font-semibold">Recent navigations</h2>
      <ul className="divide-y rounded-md border text-sm">
        {runs.length === 0 ? (
          <li className="px-3 py-4 text-muted-foreground">No navigations recorded.</li>
        ) : (
          runs.map((run) => (
            <li key={run.id} className="px-3 py-2">
              <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                {run.status}
              </span>
              <span className="mr-2 text-xs">{run.verificationResult}</span>
              <span className="text-xs text-muted-foreground">
                {run.expectedOrigin} · session {run.sessionId.slice(0, 8)} ·{" "}
                {formatDateTime(run.createdAt)}
              </span>
            </li>
          ))
        )}
      </ul>
    </>
  );
}
