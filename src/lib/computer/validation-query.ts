import type { PrismaClient } from "@prisma/client";
import {
  VALIDATION_FAILURES,
  buildValidationReport,
  isValidationAssessment,
  type NavigationFact,
  type RecommendationFact,
  type ValidationAssessment,
  type ValidationFailure,
  type ValidationReport,
} from "@/lib/computer/validation";

/**
 * Computer C4.1 — validation derivation.
 *
 * Reads ordinary Operanto domain state (ComputerAction, ApprovalRequest,
 * AIAction, AuditEvent) and aggregates non-sensitive operational facts.
 * It introduces NO new browser authority, NO new persistence and NO
 * external analytics dependency — every number comes from rows the C1–C4
 * slices already write, so the same report works in Operanto Cloud, a
 * private cloud, or a customer-managed deployment.
 *
 * Nothing here reads page text, titles, URLs, element names, goals,
 * prompts or model responses: only ids, enums, booleans, counts and
 * timestamps.
 */

/**
 * The database client this derivation needs. `PrismaClient` satisfies it,
 * from the Next.js server and from a plain CLI alike — no `server-only`
 * import here, so the report is runnable in any deployment shape.
 */
export type ValidationClient = Pick<
  PrismaClient,
  "aIAction" | "computerAction" | "approvalRequest" | "auditEvent"
>;

export type ValidationWindow = {
  since?: Date;
  until?: Date;
  /** Group by an explicit validation campaign (AuditEvent.correlationId). */
  campaign?: string | null;
};

function windowWhere(window: ValidationWindow) {
  if (!window.since && !window.until) return {};
  return {
    createdAt: {
      ...(window.since ? { gte: window.since } : {}),
      ...(window.until ? { lte: window.until } : {}),
    },
  };
}

function msBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null;
  const delta = to.getTime() - from.getTime();
  return delta >= 0 ? delta : null;
}

/**
 * Derive the validation report for ONE organisation. Client-agnostic and
 * free of `server-only`/RBAC so the server service (which adds the
 * permission check) and the CLI report share one derivation — there is no
 * second copy of these definitions to drift.
 */
export async function deriveValidationReport(
  db: ValidationClient,
  organisationId: string,
  window: ValidationWindow = {},
): Promise<ValidationReport & { campaign: string | null }> {
  const campaign = window.campaign ?? null;
  const scoped = { organisationId };

  // ── Recommendations: completed COMPUTER_GUIDE tasks ──────────────
  const guides = await db.aIAction.findMany({
    where: {
      ...scoped,
      taskType: "COMPUTER_GUIDE",
      status: { in: ["COMPLETED", "SUPERSEDED"] },
      ...windowWhere(window),
    },
    select: {
      id: true,
      createdAt: true,
      outputJson: true,
      redactedAt: true,
      computerSnapshot: { select: { createdAt: true } },
    },
    take: 2000,
  });
  const recommendations: RecommendationFact[] = guides.map((guide) => {
    // Only the grounding VERDICT is read — never the guidance text. A
    // redacted row simply contributes no bound-target signal.
    const grounding =
      !guide.redactedAt && guide.outputJson && typeof guide.outputJson === "object"
        ? ((guide.outputJson as Record<string, unknown>).grounding as
            | { target?: string }
            | undefined)
        : undefined;
    return {
      boundTarget: grounding?.target === "BOUND",
      captureToRecommendationMs: msBetween(
        guide.computerSnapshot?.createdAt ?? null,
        guide.createdAt,
      ),
    };
  });

  // ── Navigations: OPEN_SAFE_LINK actions + their approval gates ────
  const actions = await db.computerAction.findMany({
    where: {
      ...scoped,
      actionType: "OPEN_SAFE_LINK",
      ...windowWhere(window),
    },
    select: {
      id: true,
      status: true,
      verificationResult: true,
      createdAt: true,
      decidedAt: true,
      executionClaimedAt: true,
      executedAt: true,
      verifiedAt: true,
      expectedHref: true,
      expectedOrigin: true,
      afterSnapshot: { select: { url: true } },
    },
    take: 2000,
  });
  const approvals = await db.approvalRequest.findMany({
    where: {
      ...scoped,
      sourceType: "COMPUTER_ACTION",
      sourceId: { in: actions.map((action) => action.id) },
    },
    select: { sourceId: true, status: true, requestedAt: true, decidedAt: true },
  });
  const approvalBySource = new Map(approvals.map((row) => [row.sourceId, row]));

  const navigations: NavigationFact[] = actions.map((action) => {
    const approval = approvalBySource.get(action.id);
    return {
      status: action.status,
      verificationResult: action.verificationResult,
      approvalStatus: (approval?.status as NavigationFact["approvalStatus"]) ?? null,
      proposedToDecisionMs: msBetween(
        approval?.requestedAt ?? action.createdAt,
        approval?.decidedAt ?? null,
      ),
      approvalToVerifiedMs: msBetween(
        approval?.decidedAt ?? null,
        action.verifiedAt ?? null,
      ),
      claimed: action.executionClaimedAt !== null,
      executed: action.executedAt !== null,
    };
  });

  // ── Refusals + assessments + dropped links: from audit events ─────
  const auditRows = await db.auditEvent.findMany({
    where: {
      ...scoped,
      eventType: {
        in: [
          "computer.navigation.refused",
          "computer.validation.assessed",
          "computer.snapshot.recorded",
        ],
      },
      ...(campaign ? { correlationId: campaign } : {}),
      ...(window.since || window.until
        ? {
            occurredAt: {
              ...(window.since ? { gte: window.since } : {}),
              ...(window.until ? { lte: window.until } : {}),
            },
          }
        : {}),
    },
    select: { eventType: true, afterMetadata: true },
    take: 5000,
  });

  const failures: ValidationFailure[] = [];
  const assessments: ValidationAssessment[] = [];
  let droppedLinkCount = 0;
  for (const row of auditRows) {
    const meta = (row.afterMetadata ?? {}) as Record<string, unknown>;
    if (row.eventType === "computer.navigation.refused") {
      const reason = String(meta.reason ?? "");
      // Closed vocabulary only — an unrecognised value is ignored rather
      // than becoming an ad-hoc analytics dimension.
      if ((VALIDATION_FAILURES as readonly string[]).includes(reason)) {
        failures.push(reason as ValidationFailure);
      }
    } else if (row.eventType === "computer.validation.assessed") {
      const assessment = String(meta.assessment ?? "");
      if (isValidationAssessment(assessment)) assessments.push(assessment);
    } else if (row.eventType === "computer.snapshot.recorded") {
      const dropped = meta.droppedLinkCount;
      if (typeof dropped === "number" && Number.isFinite(dropped)) {
        droppedLinkCount += dropped;
      }
    }
  }

  // Terminal outcomes that are also failure evidence.
  for (const nav of navigations) {
    if (nav.approvalStatus === "REJECTED") failures.push("USER_REJECTED");
    if (nav.status === "CANCELLED") failures.push("USER_CANCELLED");
    if (nav.verificationResult === "INCONCLUSIVE") {
      failures.push("VERIFICATION_INCONCLUSIVE");
    }
    if (nav.verificationResult === "FAILED") failures.push("VERIFICATION_FAILED");
  }
  for (const assessment of assessments) {
    if (assessment === "WRONG_RECOMMENDATION") failures.push("WRONG_RECOMMENDATION");
  }

  // ── Invariant breaches: computed from state, never from refusals ──
  // A blocked attempt is the protection working, not a breach. A breach
  // would be an action that actually executed outside policy.
  let crossOriginEscapes = 0;
  let sensitiveUrlPersistence = 0;
  for (const action of actions) {
    const href = action.expectedHref ?? "";
    if (href.includes("?") || href.includes("#")) sensitiveUrlPersistence += 1;
    if (action.executedAt && action.afterSnapshot?.url && action.expectedOrigin) {
      try {
        if (new URL(action.afterSnapshot.url).origin !== action.expectedOrigin) {
          crossOriginEscapes += 1;
        }
      } catch {
        crossOriginEscapes += 1;
      }
    }
  }
  // What a successful replay or approval bypass would look like in the
  // data: an action that reached execution WITHOUT a granted approval.
  // (Counting "two executions of one action" is not possible — the
  // one-shot nonce makes a second claim unrepresentable — so this checks
  // the observable consequence instead of an impossible shape.)
  const replaySuccesses = actions.filter(
    (action) =>
      (action.executionClaimedAt !== null || action.executedAt !== null) &&
      approvalBySource.get(action.id)?.status !== "APPROVED",
  ).length;
  // Any browser-side effect other than OPEN_SAFE_LINK reaching execution.
  const unauthorizedSideEffects = await db.computerAction.count({
    where: {
      ...scoped,
      actionType: { not: "OPEN_SAFE_LINK" },
      status: { in: ["EXECUTING", "EXECUTED"] },
    },
  });

  return {
    ...buildValidationReport({
      recommendations,
      navigations,
      failures,
      assessments,
      droppedLinkCount,
      invariantBreaches: {
        unauthorizedSideEffects,
        crossOriginEscapes,
        replaySuccesses,
        sensitiveUrlPersistence,
      },
    }),
    campaign,
  };
}

