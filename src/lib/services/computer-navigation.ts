import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type ComputerAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit, auditSystem } from "@/lib/audit";
import {
  computerNavigationEnabled,
  computerValidationCampaign,
} from "@/lib/computer-flag";
import type { ValidationFailure } from "@/lib/computer/validation";
import {
  OPEN_SESSION_STATUSES,
  approvalRiskLevelFor,
  computerApprovalActionType,
} from "@/lib/computer/policy";
import {
  classifySafeLink,
  resolveSafeLink,
  safeLinksSchema,
  type SafeLink,
} from "@/lib/computer/safe-link";
import { BridgeAuthError } from "@/lib/services/computer";

/**
 * Computer C4 — SAFE SINGLE NAVIGATION.
 *
 * The only execution primitive is OPEN_SAFE_LINK: exactly one approved
 * same-origin anchor navigation per fresh observation, then STOP. There is
 * no loop, no autonomous stepping, no general click, no model-supplied URL
 * or selector — the model may only recommend a link that the deterministic
 * layer already extracted, verified and bound.
 *
 *   fresh snapshot → binding → ComputerAction → ApprovalRequest
 *   → one-shot nonce → extension revalidation → navigation
 *   → post-navigation snapshot → deterministic verification → audit → STOP
 *
 * Every hop fails closed: an action binds to (snapshot, ephemeral element
 * ref, expected href/origin, bridge, tenant); the nonce is single-use and
 * short-lived; approval cannot be replayed for another action; the
 * extension independently re-checks the safe-link policy before navigating;
 * and verification is computed from a NEW snapshot, never self-reported.
 */

/** Short by design: an execution credential is not a session. */
const EXECUTION_TTL_MS = 2 * 60_000;
/** A snapshot older than this cannot ground a navigation — capture again. */
const SNAPSHOT_FRESHNESS_MS = 10 * 60_000;

function hashNonce(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function readSafeLinks(value: Prisma.JsonValue | null): SafeLink[] {
  if (!value) return [];
  const parsed = safeLinksSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * Record a REFUSAL. C4 previously failed closed silently, which left no
 * trace of a replayed credential or a cross-tenant claim attempt — a
 * security-observability gap as much as a validation one. The reason is a
 * bounded enum from the validation taxonomy; arbitrary exception messages
 * are never recorded. Metadata stays ids + enums: no URL, href, element
 * name, page text or token ever enters an audit row.
 */
async function auditRefusal(
  organisationId: string,
  reason: ValidationFailure,
  refs: { sessionId?: string | null; actionId?: string | null; bridgeId?: string | null },
): Promise<void> {
  await auditSystem(organisationId, "SYSTEM", {
    eventType: "computer.navigation.refused",
    targetType: refs.actionId ? "ComputerAction" : "ComputerSession",
    targetId: refs.actionId ?? refs.sessionId ?? undefined,
    after: {
      reason,
      sessionId: refs.sessionId ?? null,
      bridgeId: refs.bridgeId ?? null,
    },
    correlationId: computerValidationCampaign() ?? undefined,
  });
}

export class NavigationError extends Error {
  constructor(
    public readonly code:
      | "STALE_SNAPSHOT"
      | "TARGET_NOT_FOUND"
      | "TARGET_AMBIGUOUS"
      | "UNSAFE_TARGET"
      | "BRIDGE_NOT_ATTACHED"
      | "NOT_ENABLED",
    message: string,
  ) {
    super(message);
    this.name = "NavigationError";
  }
}

/**
 * Propose one navigation. Binds deterministically to a safe link in the
 * snapshot — the caller may pass the ephemeral `ref` or the accessible
 * name; ambiguity and absence both fail closed. Creates the ComputerAction
 * (R1_NAVIGATE) and, because this is the first execution slice, ALWAYS an
 * ApprovalRequest through the existing unified gate.
 */
export async function proposeSafeNavigation(
  ctx: OrgContext,
  sessionId: string,
  target: { ref?: string; name?: string },
  reason: string,
): Promise<{ action: ComputerAction; approvalRequestId: string }> {
  requirePermission(ctx.membership.role, "computer:operate");
  if (!computerNavigationEnabled()) {
    throw new NavigationError("NOT_ENABLED", "Computer navigation is not enabled");
  }
  const trimmedReason = reason.trim();
  if (!trimmedReason || trimmedReason.length > 1000) {
    throw new Error("Reason must be 1–1000 characters");
  }

  const session = await prisma.computerSession.findFirst({
    where: { ...scope(ctx), id: sessionId },
    select: { id: true, status: true, conversationId: true },
  });
  if (!session) throw new Error("Computer session not found");
  // Any OPEN session may navigate — the observe→understand→navigate flow
  // never requires a ComputerPlan (workbench sessions stay CREATED), and
  // freshness is enforced on the snapshot, not on the session's status.
  if (!OPEN_SESSION_STATUSES.includes(session.status)) {
    throw new Error(`Navigation cannot be proposed for a ${session.status} session`);
  }

  // Freshness: only the LATEST snapshot may ground a navigation, and only
  // while it is recent. Anything older requires a new capture.
  const snapshot = await prisma.computerSnapshot.findFirst({
    where: { ...scope(ctx), sessionId: session.id, redactedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!snapshot) throw new Error("Capture a page before proposing navigation");
  if (Date.now() - snapshot.createdAt.getTime() > SNAPSHOT_FRESHNESS_MS) {
    await auditRefusal(ctx.organisation.id, "STALE_SNAPSHOT", {
      sessionId: session.id,
    });
    throw new NavigationError(
      "STALE_SNAPSHOT",
      "The observation is too old to act on — capture the page again",
    );
  }
  // The bridge that produced the observation must still be attached: an
  // action belongs to the tab it was observed in.
  if (!snapshot.bridgeId) {
    throw new NavigationError(
      "BRIDGE_NOT_ATTACHED",
      "Only a bridge-captured observation can ground navigation",
    );
  }
  const bridge = await prisma.computerBridgeGrant.findFirst({
    where: { ...scope(ctx), id: snapshot.bridgeId, status: "ATTACHED" },
    select: { id: true },
  });
  if (!bridge) {
    await auditRefusal(ctx.organisation.id, "BRIDGE_DETACHED", {
      sessionId: session.id,
    });
    throw new NavigationError("BRIDGE_NOT_ATTACHED", "The browser bridge is not attached");
  }

  const resolved = resolveSafeLink(readSafeLinks(snapshot.safeLinksJson), target);
  if (!resolved.ok) {
    await auditRefusal(
      ctx.organisation.id,
      resolved.reason === "AMBIGUOUS" ? "AMBIGUOUS_TARGET" : "TARGET_NOT_FOUND",
      { sessionId: session.id },
    );
    throw new NavigationError(
      resolved.reason === "AMBIGUOUS" ? "TARGET_AMBIGUOUS" : "TARGET_NOT_FOUND",
      resolved.reason === "AMBIGUOUS"
        ? "More than one safe link matches — capture again or choose a distinct target"
        : "No safe same-origin link matches that target in the current observation",
    );
  }
  // Re-classify at proposal time too (defence in depth against a snapshot
  // whose stored links were somehow written by an older/looser path).
  const verdict = classifySafeLink({
    href: resolved.link.href,
    pageUrl: resolved.link.href,
  });
  if (!verdict.safe) {
    await auditRefusal(ctx.organisation.id, "POLICY_REJECTED", {
      sessionId: session.id,
    });
    throw new NavigationError("UNSAFE_TARGET", "The target is not a safe link");
  }

  const { action, approvalRequestId } = await prisma.$transaction(async (tx) => {
    const action = await tx.computerAction.create({
      data: {
        organisationId: ctx.organisation.id,
        sessionId: session.id,
        actionType: "OPEN_SAFE_LINK",
        riskTier: "R1_NAVIGATE",
        // First execution slice: navigation is approval-gated regardless of
        // its R1 tier.
        status: "APPROVAL_PENDING",
        reason: trimmedReason,
        targetJson: {
          kind: "semantic",
          role: "link",
          name: resolved.link.name,
        } as Prisma.InputJsonValue,
        proposedByMembershipId: ctx.membership.id,
        beforeSnapshotId: snapshot.id,
        targetRef: resolved.link.ref,
        expectedHref: verdict.url,
        expectedOrigin: verdict.origin,
      },
    });
    const approval = await tx.approvalRequest.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: session.conversationId,
        sourceType: "COMPUTER_ACTION",
        sourceId: action.id,
        actionType: computerApprovalActionType("OPEN_SAFE_LINK"),
        requestedByMembershipId: ctx.membership.id,
        // Describes exactly what will happen, without page content beyond
        // the link the human is approving.
        originalPayload: {
          actionType: "OPEN_SAFE_LINK",
          riskTier: "R1_NAVIGATE",
          linkName: resolved.link.name,
          expectedHref: verdict.url,
          expectedOrigin: verdict.origin,
          reason: trimmedReason,
        } as Prisma.InputJsonValue,
        riskLevel: approvalRiskLevelFor("R1_NAVIGATE"),
        lowConfidence: false,
        idempotencyKey: action.id,
        // Approval itself expires: a stale decision cannot be executed.
        expiresAt: new Date(Date.now() + SNAPSHOT_FRESHNESS_MS),
      },
    });
    return { action, approvalRequestId: approval.id };
  });

  await audit(ctx, {
    eventType: "computer.navigation.proposed",
    targetType: "ComputerAction",
    targetId: action.id,
    after: {
      sessionId: session.id,
      snapshotId: snapshot.id,
      bridgeId: bridge.id,
      approvalRequestId,
      // Origin is operational metadata, not page content; the href/name are
      // deliberately NOT audited.
      expectedOrigin: verdict.origin,
    },
    correlationId: computerValidationCampaign() ?? undefined,
  });
  return { action, approvalRequestId };
}

/**
 * Mint the one-shot execution credential for an APPROVED navigation. The
 * raw nonce is returned once (to the operator's browser, for the
 * extension); only its hash is stored. Claiming is atomic — a second call
 * cannot mint a second credential for the same action.
 */
export async function issueNavigationNonce(
  ctx: OrgContext,
  actionId: string,
): Promise<{ nonce: string; expiresAt: Date }> {
  requirePermission(ctx.membership.role, "computer:operate");
  if (!computerNavigationEnabled()) {
    throw new NavigationError("NOT_ENABLED", "Computer navigation is not enabled");
  }
  const action = await prisma.computerAction.findFirst({
    where: {
      ...scope(ctx),
      id: actionId,
      actionType: "OPEN_SAFE_LINK",
      status: "APPROVED",
    },
    select: { id: true, executionNonceHash: true },
  });
  if (!action) throw new Error("No approved navigation to execute");
  if (action.executionNonceHash) {
    throw new Error("An execution credential was already issued for this action");
  }
  const nonce = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + EXECUTION_TTL_MS);
  const claimed = await prisma.computerAction.updateMany({
    where: { ...scope(ctx), id: action.id, status: "APPROVED", executionNonceHash: null },
    data: { executionNonceHash: hashNonce(nonce), executionExpiresAt: expiresAt },
  });
  if (claimed.count === 0) {
    throw new Error("An execution credential was already issued for this action");
  }
  await audit(ctx, {
    eventType: "computer.navigation.credential_issued",
    targetType: "ComputerAction",
    targetId: action.id,
    after: { expiresAt: expiresAt.toISOString() },
    correlationId: computerValidationCampaign() ?? undefined,
  });
  return { nonce, expiresAt };
}

export type NavigationCommand = {
  actionId: string;
  /** Snapshot-scoped ephemeral identity the extension must re-locate. */
  targetRef: string;
  linkName: string;
  expectedHref: string;
  expectedOrigin: string;
  /** The page the observation came from — origin continuity check. */
  observedUrl: string | null;
};

/**
 * Extension-side claim: exchange the bridge token + one-shot nonce for the
 * navigation command. Atomically moves APPROVED → EXECUTING so the nonce
 * can never be replayed. Every binding is re-checked here: tenant, bridge
 * attachment, session openness, approval state, expiry, and the safe-link
 * policy. The extension MUST still re-check the policy itself.
 */
export async function claimNavigationCommand(
  rawBridgeToken: string,
  rawNonce: string,
): Promise<NavigationCommand> {
  if (!computerNavigationEnabled()) {
    throw new BridgeAuthError("Computer navigation is not enabled");
  }
  const bridge = await prisma.computerBridgeGrant.findUnique({
    where: { tokenHash: createHash("sha256").update(rawBridgeToken).digest("hex") },
    include: { session: { select: { id: true, status: true } } },
  });
  if (!bridge) throw new BridgeAuthError("Unknown bridge token");
  if (bridge.status !== "ATTACHED" || bridge.expiresAt.getTime() <= Date.now()) {
    await auditRefusal(bridge.organisationId, "BRIDGE_DETACHED", {
      sessionId: bridge.sessionId,
      bridgeId: bridge.id,
    });
    throw new BridgeAuthError("The bridge is not attached");
  }
  if (!OPEN_SESSION_STATUSES.includes(bridge.session.status)) {
    await auditRefusal(bridge.organisationId, "BRIDGE_DETACHED", {
      sessionId: bridge.sessionId,
      bridgeId: bridge.id,
    });
    throw new BridgeAuthError("The session is not open");
  }

  const action = await prisma.computerAction.findUnique({
    where: { executionNonceHash: hashNonce(rawNonce) },
    include: { beforeSnapshot: { select: { id: true, url: true, bridgeId: true } } },
  });
  if (!action) {
    // An unknown credential is either a typo or a probe; either way it is
    // worth a trace against the bridge that presented it.
    await auditRefusal(bridge.organisationId, "REPLAYED_CREDENTIAL", {
      sessionId: bridge.sessionId,
      bridgeId: bridge.id,
    });
    throw new BridgeAuthError("Unknown execution credential");
  }
  // Cross-tenant / cross-session / cross-tab binding checks.
  if (
    action.organisationId !== bridge.organisationId ||
    action.sessionId !== bridge.sessionId ||
    action.beforeSnapshot?.bridgeId !== bridge.id
  ) {
    await auditRefusal(bridge.organisationId, "WRONG_TENANT_OR_SESSION", {
      sessionId: bridge.sessionId,
      actionId: action.id,
      bridgeId: bridge.id,
    });
    throw new BridgeAuthError("The credential does not belong to this bridge");
  }
  if (action.status !== "APPROVED") {
    // Already EXECUTING/EXECUTED → a replay of a spent credential.
    await auditRefusal(action.organisationId, "REPLAYED_CREDENTIAL", {
      sessionId: action.sessionId,
      actionId: action.id,
      bridgeId: bridge.id,
    });
    throw new BridgeAuthError("The action is not approved for execution");
  }
  if (!action.executionExpiresAt || action.executionExpiresAt.getTime() <= Date.now()) {
    await auditRefusal(action.organisationId, "ACTION_EXPIRED", {
      sessionId: action.sessionId,
      actionId: action.id,
      bridgeId: bridge.id,
    });
    throw new BridgeAuthError("The execution credential has expired");
  }
  // The approval itself must still be APPROVED and unexpired.
  const approval = await prisma.approvalRequest.findFirst({
    where: {
      organisationId: action.organisationId,
      sourceType: "COMPUTER_ACTION",
      sourceId: action.id,
      status: "APPROVED",
    },
    select: { id: true, expiresAt: true },
  });
  if (!approval) {
    await auditRefusal(action.organisationId, "APPROVAL_EXPIRED", {
      sessionId: action.sessionId,
      actionId: action.id,
      bridgeId: bridge.id,
    });
    throw new BridgeAuthError("No valid approval for this action");
  }
  if (approval.expiresAt && approval.expiresAt.getTime() <= Date.now()) {
    await auditRefusal(action.organisationId, "APPROVAL_EXPIRED", {
      sessionId: action.sessionId,
      actionId: action.id,
      bridgeId: bridge.id,
    });
    throw new BridgeAuthError("The approval has expired");
  }
  if (!action.expectedHref || !action.expectedOrigin || !action.targetRef) {
    throw new BridgeAuthError("The action has no bound target");
  }
  // Final server-side safe-link re-check before handing out a command.
  const verdict = classifySafeLink({
    href: action.expectedHref,
    pageUrl: action.expectedHref,
  });
  if (!verdict.safe || verdict.origin !== action.expectedOrigin) {
    await auditRefusal(action.organisationId, "TARGET_CHANGED", {
      sessionId: action.sessionId,
      actionId: action.id,
      bridgeId: bridge.id,
    });
    throw new BridgeAuthError("The bound target is not a safe link");
  }

  // One-shot: APPROVED → EXECUTING, exactly once.
  const claimed = await prisma.computerAction.updateMany({
    where: { id: action.id, status: "APPROVED" },
    data: { status: "EXECUTING", executionClaimedAt: new Date() },
  });
  if (claimed.count === 0) {
    await auditRefusal(action.organisationId, "REPLAYED_CREDENTIAL", {
      sessionId: action.sessionId,
      actionId: action.id,
      bridgeId: bridge.id,
    });
    throw new BridgeAuthError("The execution credential was already used");
  }
  await auditSystem(action.organisationId, "SYSTEM", {
    eventType: "computer.navigation.claimed",
    targetType: "ComputerAction",
    targetId: action.id,
    after: { sessionId: action.sessionId, bridgeId: bridge.id },
    correlationId: computerValidationCampaign() ?? undefined,
  });

  const targetName = (action.targetJson as { name?: string } | null)?.name ?? "";
  return {
    actionId: action.id,
    targetRef: action.targetRef,
    linkName: targetName,
    expectedHref: action.expectedHref,
    expectedOrigin: action.expectedOrigin,
    observedUrl: action.beforeSnapshot?.url ?? null,
  };
}

/**
 * Extension-side report after attempting the navigation. Success is NOT
 * taken on the extension's word: the caller must have recorded a fresh
 * post-navigation snapshot, and verification is computed here from that
 * snapshot's origin/URL. The model never marks its own action verified.
 */
export async function reportNavigationResult(
  rawBridgeToken: string,
  actionId: string,
  result: { ok: boolean; error?: string },
): Promise<{ status: string; verification: string }> {
  if (!computerNavigationEnabled()) {
    throw new BridgeAuthError("Computer navigation is not enabled");
  }
  const bridge = await prisma.computerBridgeGrant.findUnique({
    where: { tokenHash: createHash("sha256").update(rawBridgeToken).digest("hex") },
    select: { id: true, organisationId: true, sessionId: true, status: true },
  });
  if (!bridge || bridge.status !== "ATTACHED") {
    throw new BridgeAuthError("The bridge is not attached");
  }
  const action = await prisma.computerAction.findFirst({
    where: {
      id: actionId,
      organisationId: bridge.organisationId,
      sessionId: bridge.sessionId,
      status: "EXECUTING",
    },
  });
  if (!action) throw new BridgeAuthError("No navigation in flight for this action");

  if (!result.ok) {
    await prisma.computerAction.updateMany({
      where: { id: action.id, status: "EXECUTING" },
      data: {
        status: "EXECUTION_FAILED",
        executionError: (result.error ?? "extension reported failure").slice(0, 300),
        verificationResult: "FAILED",
        verifiedAt: new Date(),
      },
    });
    await auditSystem(bridge.organisationId, "SYSTEM", {
      eventType: "computer.navigation.failed",
      targetType: "ComputerAction",
      targetId: action.id,
      after: { sessionId: action.sessionId },
      correlationId: computerValidationCampaign() ?? undefined,
    });
    // The extension refusing on its own policy is the most important
    // signal C4.1 collects: it means server approval alone did not suffice.
    await auditRefusal(bridge.organisationId, "EXTENSION_REJECTED", {
      sessionId: action.sessionId,
      actionId: action.id,
      bridgeId: bridge.id,
    });
    return { status: "EXECUTION_FAILED", verification: "FAILED" };
  }

  // Deterministic verification from the newest snapshot captured AFTER the
  // execution claim — the extension's success claim alone proves nothing.
  const after = await prisma.computerSnapshot.findFirst({
    where: {
      organisationId: bridge.organisationId,
      sessionId: action.sessionId,
      bridgeId: bridge.id,
      createdAt: { gt: action.executionClaimedAt ?? action.createdAt },
    },
    orderBy: { createdAt: "desc" },
  });

  let verification: "VERIFIED" | "INCONCLUSIVE" | "FAILED" = "INCONCLUSIVE";
  let note = "No post-navigation observation was received.";
  if (after?.url) {
    let sameOrigin = false;
    let matches = false;
    try {
      const observed = new URL(after.url);
      sameOrigin = observed.origin === action.expectedOrigin;
      const expected = new URL(action.expectedHref ?? "");
      matches =
        sameOrigin && observed.pathname === expected.pathname;
    } catch {
      sameOrigin = false;
    }
    if (matches) {
      verification = "VERIFIED";
      note = "The post-navigation observation is on the expected page.";
    } else if (sameOrigin) {
      verification = "INCONCLUSIVE";
      note = "Origin continuity held, but the observed page is not the expected one.";
    } else {
      // Origin discontinuity after a same-origin navigation is a red flag.
      verification = "FAILED";
      note = "The post-navigation observation left the expected origin.";
    }
  }

  await prisma.computerAction.updateMany({
    where: { id: action.id, status: "EXECUTING" },
    data: {
      status: verification === "FAILED" ? "EXECUTION_FAILED" : "EXECUTED",
      executedAt: new Date(),
      afterSnapshotId: after?.id ?? null,
      verificationResult: verification,
      verificationNote: note,
      verifiedAt: new Date(),
    },
  });
  await auditSystem(bridge.organisationId, "SYSTEM", {
    eventType: "computer.navigation.executed",
    targetType: "ComputerAction",
    targetId: action.id,
    after: {
      sessionId: action.sessionId,
      afterSnapshotId: after?.id ?? null,
      verification,
    },
    correlationId: computerValidationCampaign() ?? undefined,
  });
  return {
    status: verification === "FAILED" ? "EXECUTION_FAILED" : "EXECUTED",
    verification,
  };
}
