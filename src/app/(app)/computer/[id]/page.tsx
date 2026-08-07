import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/org-context";
import { getComputerSession } from "@/lib/services/computer";
import { listComputerUnderstandings } from "@/lib/services/computer-understanding";
import type {
  ComputerGuideOutput,
  ComputerUnderstandOutput,
} from "@/lib/ai/computer-tasks";
import { PageHeader } from "@/components/app/page-header";
import { formatDateTime } from "@/lib/format";
import { computerNavigationEnabled } from "@/lib/computer-flag";
import type { SafeLink } from "@/lib/computer/safe-link";
import { BridgePanel } from "./bridge-panel";
import { NavigationCodePanel } from "./navigation-panel";
import { VALIDATION_ASSESSMENTS as ASSESSMENTS } from "@/lib/computer/validation";
import {
  analyzeAction,
  assessNavigationAction,
  cancelSessionAction,
  detachBridgeAction,
  proposeNavigationAction,
} from "./actions";

export const metadata: Metadata = { title: "Computer session" };

type UnderstandingView = Partial<ComputerGuideOutput> &
  ComputerUnderstandOutput & {
    grounding?: { factsRemoved: number; target: string };
  };

function Understanding({ output }: { output: UnderstandingView }) {
  return (
    <div className="space-y-3 text-sm">
      <p>
        <span className="font-medium">Page purpose:</span> {output.pagePurpose}
      </p>
      <p>{output.summary}</p>
      {output.observedFacts.length > 0 ? (
        <ul className="space-y-1">
          {/* Only the EVIDENCE is deterministically verified (it exists in
              the snapshot). The claim is the model's INTERPRETATION of that
              evidence and is never presented as proven. */}
          {output.observedFacts.map((fact, index) => (
            <li key={index}>
              <span className="mr-1 rounded bg-emerald-100 px-1 py-0.5 text-xs font-medium text-emerald-900">
                OBSERVED
              </span>
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{fact.evidence}</code>
              <span className="mx-1 rounded bg-slate-100 px-1 py-0.5 text-xs font-medium text-slate-700">
                INTERPRETATION
              </span>
              {fact.claim}
            </li>
          ))}
        </ul>
      ) : null}
      {output.inferences?.length ? (
        <ul className="space-y-1">
          {output.inferences.map((inference, index) => (
            <li key={index}>
              <span className="mr-1 rounded bg-sky-100 px-1 py-0.5 text-xs font-medium text-sky-900">
                INFERENCE
              </span>
              {inference}
            </li>
          ))}
        </ul>
      ) : null}
      {output.suggestedNextStep ? (
        <p>
          <span className="mr-1 rounded bg-amber-100 px-1 py-0.5 text-xs font-medium text-amber-900">
            GUIDANCE
          </span>
          {output.suggestedNextStep}
          {output.suggestedElement ? (
            <code className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
              {output.suggestedElement.role}: {output.suggestedElement.name}
            </code>
          ) : null}
        </p>
      ) : null}
      {output.warnings.map((warning, index) => (
        <p key={index} className="text-amber-700">
          ⚠ {warning}
        </p>
      ))}
      {output.limitations.map((limitation, index) => (
        <p key={index} className="text-xs text-muted-foreground">
          {limitation}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">
        Confidence: {Math.round(output.confidence * 100)}%
        {output.grounding
          ? ` · grounding: ${output.grounding.factsRemoved} claim(s) removed, target ${output.grounding.target}`
          : null}
      </p>
    </div>
  );
}

export default async function ComputerSessionPage({
  params,
  searchParams,
}: PageProps<"/computer/[id]">) {
  const ctx = await requireOrg();
  const { id } = await params;
  const search = await searchParams;
  const error = typeof search.error === "string" ? search.error : null;

  const session = await getComputerSession(ctx, id);
  if (!session) notFound();
  const understandings = await listComputerUnderstandings(ctx, session.id);
  const latest = understandings.find((action) => action.status === "COMPLETED");
  const activeBridge = session.bridges.find(
    (bridge) => bridge.status === "PENDING" || bridge.status === "ATTACHED",
  );
  const open = ["CREATED", "PLANNING", "READY"].includes(session.status);
  const navigationEnabled = computerNavigationEnabled();
  const latestSnapshot = session.snapshots[session.snapshots.length - 1];
  const safeLinks = (latestSnapshot?.safeLinksJson ?? []) as SafeLink[];
  const navigations = session.actions.filter(
    (action) => action.actionType === "OPEN_SAFE_LINK",
  );

  return (
    <>
      <PageHeader title="Computer session" description={session.goal}>
        <span className="rounded bg-muted px-2 py-1 text-xs">{session.status}</span>
      </PageHeader>
      <p className="mb-4 text-xs text-muted-foreground">
        Observation only: Operanto can see what you share and advise you. It
        cannot click, type, or navigate — every step on the page is yours.{" "}
        <Link href="/computer" className="underline">
          All sessions
        </Link>
      </p>
      {error ? (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Browser bridge</h2>
          {activeBridge ? (
            <div className="rounded-md border p-3 text-sm">
              <p>
                Bridge {activeBridge.status === "ATTACHED" ? "attached" : "waiting for the extension"} ·{" "}
                {activeBridge.captureCount} capture(s)
                {activeBridge.lastCaptureAt
                  ? ` · last ${formatDateTime(activeBridge.lastCaptureAt)}`
                  : ""}
              </p>
              <form action={detachBridgeAction} className="mt-2">
                <input type="hidden" name="sessionId" value={session.id} />
                <input type="hidden" name="grantId" value={activeBridge.id} />
                <button className="h-8 rounded-md border border-input px-2 text-xs hover:bg-muted">
                  Detach bridge
                </button>
              </form>
            </div>
          ) : open ? (
            <BridgePanel sessionId={session.id} />
          ) : (
            <p className="text-sm text-muted-foreground">Session is closed.</p>
          )}

          <h2 className="text-sm font-semibold">Snapshots</h2>
          <ul className="divide-y rounded-md border text-sm">
            {session.snapshots.length === 0 ? (
              <li className="px-3 py-4 text-muted-foreground">
                No snapshots yet — attach the tab and press “Share this tab” in
                the extension.
              </li>
            ) : (
              session.snapshots.map((snapshot) => (
                <li key={snapshot.id} className="px-3 py-2">
                  <span className="font-medium">{snapshot.pageTitle ?? "(untitled)"}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {snapshot.url ?? ""} · {formatDateTime(snapshot.createdAt)}
                  </span>
                </li>
              ))
            )}
          </ul>

          {navigationEnabled ? (
            <>
              <h2 className="text-sm font-semibold">Navigation (one approved step)</h2>
              {open && safeLinks.length > 0 ? (
                <form
                  action={proposeNavigationAction}
                  className="space-y-2 rounded-md border p-3 text-sm"
                >
                  <input type="hidden" name="sessionId" value={session.id} />
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted-foreground">
                      Safe same-origin links observed in the latest capture
                    </span>
                    <select
                      name="targetRef"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {safeLinks.map((link) => (
                        <option key={link.ref} value={link.ref}>
                          {link.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    name="reason"
                    maxLength={1000}
                    placeholder="Why open this link?"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  />
                  <button className="h-9 rounded-md border border-input px-3 text-sm font-medium hover:bg-muted">
                    Propose opening this link (needs approval)
                  </button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {open
                    ? "No safe same-origin links in the latest capture."
                    : "Session is closed."}
                </p>
              )}
              {navigations.length > 0 ? (
                <ul className="divide-y rounded-md border text-sm">
                  {navigations.map((action) => (
                    <li key={action.id} className="px-3 py-2">
                      <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                        {action.status}
                      </span>
                      {(action.targetJson as { name?: string } | null)?.name ?? "link"}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {action.expectedOrigin} · verification{" "}
                        {action.verificationResult}
                      </span>
                      {action.status === "APPROVED" ? (
                        <NavigationCodePanel actionId={action.id} />
                      ) : null}
                      {["EXECUTED", "EXECUTION_FAILED"].includes(action.status) ? (
                        <form action={assessNavigationAction} className="mt-2 flex gap-1">
                          <input type="hidden" name="sessionId" value={session.id} />
                          <input type="hidden" name="actionId" value={action.id} />
                          <span className="self-center text-xs text-muted-foreground">
                            Did this help?
                          </span>
                          {ASSESSMENTS.map((value) => (
                            <button
                              key={value}
                              name="assessment"
                              value={value}
                              className="rounded-md border border-input px-2 py-0.5 text-xs hover:bg-muted"
                            >
                              {value.replace(/_/g, " ").toLowerCase()}
                            </button>
                          ))}
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}

          {open ? (
            <form action={cancelSessionAction}>
              <input type="hidden" name="sessionId" value={session.id} />
              <button className="h-8 rounded-md border border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10">
                End session
              </button>
            </form>
          ) : null}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Ask Operanto</h2>
          <form action={analyzeAction} className="space-y-2 rounded-md border p-3">
            <input type="hidden" name="sessionId" value={session.id} />
            <input
              name="question"
              maxLength={400}
              placeholder="Optional question, e.g. Where should I look next?"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                name="mode"
                value="understand"
                className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
              >
                What am I looking at?
              </button>
              <button
                name="mode"
                value="guide"
                className="h-9 rounded-md border border-input px-3 text-sm font-medium hover:bg-muted"
              >
                Where should I look next?
              </button>
            </div>
          </form>

          {latest?.outputJson ? (
            <div className="rounded-md border p-3">
              <p className="mb-2 text-xs text-muted-foreground">
                {latest.taskType === "COMPUTER_GUIDE" ? "Guidance" : "Understanding"} ·{" "}
                {formatDateTime(latest.createdAt)} · {latest.provider}/{latest.model}
              </p>
              <Understanding output={latest.outputJson as unknown as UnderstandingView} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No analysis yet. Capture a page, then ask.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
