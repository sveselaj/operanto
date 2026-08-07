import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { computerValidationCampaign } from "@/lib/computer-flag";
import {
  isValidationAssessment,
  type ValidationAssessment,
  type ValidationReport,
} from "@/lib/computer/validation";
import {
  deriveValidationReport,
  type ValidationWindow as ValidationWindowInput,
} from "@/lib/computer/validation-query";

/**
 * Computer C4.1 — validation reporting.
 *
 * Reads ordinary Operanto domain state (ComputerAction, ApprovalRequest,
 * AIAction, AuditEvent) and aggregates non-sensitive operational facts. It
 * introduces NO new browser authority, NO new persistence, and NO external
 * analytics dependency — every number is derived from rows the C1–C4
 * slices already write, so the same report works in Operanto Cloud, a
 * private cloud, or a customer-managed deployment.
 *
 * Nothing in this module reads page text, titles, URLs, element names,
 * goals, prompts or model responses. Only ids, enums, booleans, counts and
 * timestamps are touched.
 */

export type { ValidationWindow } from "@/lib/computer/validation-query";

/**
 * Build the validation report for the caller's organisation. Requires
 * `computer:read` — the same authority that reads Computer sessions; C4.1
 * introduces no new permission. The derivation itself lives in
 * `@/lib/computer/validation-query` so the CLI report shares it exactly.
 */
export async function buildComputerValidationReport(
  ctx: OrgContext,
  window: ValidationWindowInput = {},
): Promise<ValidationReport & { campaign: string | null }> {
  requirePermission(ctx.membership.role, "computer:read");
  return deriveValidationReport(prisma, ctx.organisation.id, window);
}

/**
 * Record the human usefulness signal for one navigation. Stored as an
 * audit event (enum + ids only) rather than a new column — C4.1
 * deliberately adds no schema.
 */
export async function recordValidationAssessment(
  ctx: OrgContext,
  actionId: string,
  assessment: ValidationAssessment,
): Promise<void> {
  requirePermission(ctx.membership.role, "computer:operate");
  if (!isValidationAssessment(assessment)) {
    throw new Error("Unknown assessment value");
  }
  const action = await prisma.computerAction.findFirst({
    where: { ...scope(ctx), id: actionId, actionType: "OPEN_SAFE_LINK" },
    select: { id: true, sessionId: true },
  });
  if (!action) throw new Error("Computer navigation not found");
  await audit(ctx, {
    eventType: "computer.validation.assessed",
    targetType: "ComputerAction",
    targetId: action.id,
    after: { assessment, sessionId: action.sessionId } as Prisma.InputJsonValue,
    correlationId: computerValidationCampaign() ?? undefined,
  });
}

/** Recent navigations for the validation view — ids, enums and times only. */
export async function listValidationRuns(ctx: OrgContext, limit = 25) {
  requirePermission(ctx.membership.role, "computer:read");
  return prisma.computerAction.findMany({
    where: { ...scope(ctx), actionType: "OPEN_SAFE_LINK" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      sessionId: true,
      status: true,
      verificationResult: true,
      createdAt: true,
      executedAt: true,
      // Origin only — never the href, never the link name.
      expectedOrigin: true,
    },
  });
}
