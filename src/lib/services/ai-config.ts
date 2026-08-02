import "server-only";
import type { AIMode, AITaskType, AiConfiguration } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import type { OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { AIError } from "@/lib/ai/types";
import { estimateCostCents } from "@/lib/ai/policy";

/**
 * Tenant AI configuration and usage accounting.
 *
 * Safe defaults: AI is DISABLED until an administrator enables it, and mode
 * is MOCK until explicitly switched to LIVE. Deployment-level override:
 * OPERANTO_AI_LIVE_ENABLED must be "1" for LIVE mode to reach a real
 * provider at all — staging stays mock even if a row says LIVE, unless the
 * deployment explicitly opts in.
 *
 * Budget enforcement is an atomic conditional increment: concurrent requests
 * cannot slip past the limit through read-then-write races.
 */

export const ALL_TASK_TYPES: AITaskType[] = [
  "SUMMARY",
  "CLASSIFICATION",
  "REPLY_DRAFT",
  "NEXT_ACTION",
];

export async function getAiConfiguration(ctx: OrgContext): Promise<AiConfiguration> {
  requirePermission(ctx.membership.role, "ai:read");
  const existing = await prisma.aiConfiguration.findUnique({
    where: { organisationId: ctx.organisation.id },
  });
  if (existing) return existing;
  return prisma.aiConfiguration.upsert({
    where: { organisationId: ctx.organisation.id },
    update: {},
    create: { organisationId: ctx.organisation.id },
  });
}

export type AiConfigurationPatch = {
  enabled?: boolean;
  mode?: AIMode;
  model?: string;
  monthlyRequestLimit?: number;
  monthlyTokenLimit?: number | null;
  monthlyCostLimitCents?: number | null;
  permittedTaskTypes?: AITaskType[];
};

export async function updateAiConfiguration(
  ctx: OrgContext,
  patch: AiConfigurationPatch,
): Promise<AiConfiguration> {
  requirePermission(ctx.membership.role, "ai:configure");

  for (const [field, value] of [
    ["monthlyRequestLimit", patch.monthlyRequestLimit],
    ["monthlyTokenLimit", patch.monthlyTokenLimit],
    ["monthlyCostLimitCents", patch.monthlyCostLimitCents],
  ] as const) {
    if (typeof value === "number" && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`${field} must be a non-negative integer`);
    }
  }
  if (patch.model !== undefined && !patch.model.trim()) {
    throw new Error("Model must not be empty");
  }

  const before = await getAiConfiguration(ctx);
  const updated = await prisma.aiConfiguration.update({
    where: { organisationId: ctx.organisation.id },
    data: {
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
      ...(patch.model !== undefined ? { model: patch.model.trim() } : {}),
      ...(patch.monthlyRequestLimit !== undefined
        ? { monthlyRequestLimit: patch.monthlyRequestLimit }
        : {}),
      ...(patch.monthlyTokenLimit !== undefined
        ? { monthlyTokenLimit: patch.monthlyTokenLimit }
        : {}),
      ...(patch.monthlyCostLimitCents !== undefined
        ? { monthlyCostLimitCents: patch.monthlyCostLimitCents }
        : {}),
      ...(patch.permittedTaskTypes !== undefined
        ? { permittedTaskTypes: patch.permittedTaskTypes }
        : {}),
      updatedByMembershipId: ctx.membership.id,
    },
  });
  await audit(ctx, {
    eventType: "ai.configuration.changed",
    targetType: "AiConfiguration",
    targetId: updated.id,
    before: {
      enabled: before.enabled,
      mode: before.mode,
      model: before.model,
      monthlyRequestLimit: before.monthlyRequestLimit,
      monthlyTokenLimit: before.monthlyTokenLimit,
      monthlyCostLimitCents: before.monthlyCostLimitCents,
      permittedTaskTypes: before.permittedTaskTypes,
    },
    after: {
      enabled: updated.enabled,
      mode: updated.mode,
      model: updated.model,
      monthlyRequestLimit: updated.monthlyRequestLimit,
      monthlyTokenLimit: updated.monthlyTokenLimit,
      monthlyCostLimitCents: updated.monthlyCostLimitCents,
      permittedTaskTypes: updated.permittedTaskTypes,
    },
  });
  return updated;
}

/** Deployment-level gate for live provider calls (staging stays mock). */
export function liveModeEnabledForDeployment(): boolean {
  return process.env.OPERANTO_AI_LIVE_ENABLED === "1";
}

function currentPeriodStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Gate + reserve one request against the tenant budget, atomically.
 * Throws a normalized AIError when the gate refuses; manual conversation
 * handling is never affected by that refusal.
 */
export async function reserveAiUsage(
  ctx: OrgContext,
  taskType: AITaskType,
): Promise<AiConfiguration> {
  const config = await getAiConfiguration(ctx);
  if (!config.enabled) {
    throw new AIError("AI_DISABLED", "AI assistance is not enabled for this organisation");
  }
  if (!config.permittedTaskTypes.includes(taskType)) {
    throw new AIError(
      "TASK_NOT_PERMITTED",
      `Task ${taskType} is not permitted by this organisation's AI configuration`,
    );
  }

  // Roll the accounting period forward (atomic — only one winner resets).
  const periodStart = currentPeriodStart(new Date());
  if (config.periodStart < periodStart) {
    await prisma.aiConfiguration.updateMany({
      where: {
        organisationId: ctx.organisation.id,
        periodStart: { lt: periodStart },
      },
      data: {
        periodStart,
        periodRequestCount: 0,
        periodTokenCount: 0,
        periodEstimatedCostCents: 0,
      },
    });
  }

  // Reserve one request: conditional increment, no read-then-write race.
  const reserved = await prisma.aiConfiguration.updateMany({
    where: {
      organisationId: ctx.organisation.id,
      enabled: true,
      periodRequestCount: { lt: config.monthlyRequestLimit },
      ...(config.monthlyTokenLimit !== null
        ? { periodTokenCount: { lt: config.monthlyTokenLimit } }
        : {}),
      ...(config.monthlyCostLimitCents !== null
        ? { periodEstimatedCostCents: { lt: config.monthlyCostLimitCents } }
        : {}),
    },
    data: { periodRequestCount: { increment: 1 } },
  });
  if (reserved.count === 0) {
    throw new AIError(
      "BUDGET_EXHAUSTED",
      "The organisation's AI usage budget for this period is exhausted",
    );
  }
  return prisma.aiConfiguration.findUniqueOrThrow({
    where: { organisationId: ctx.organisation.id },
  });
}

/** Record final usage after a provider call (tokens + estimated cost). */
export async function finalizeAiUsage(
  organisationId: string,
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): Promise<void> {
  const tokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  const cents = estimateCostCents(model, inputTokens, outputTokens) ?? 0;
  if (tokens === 0 && cents === 0) return;
  await prisma.aiConfiguration.updateMany({
    where: { organisationId },
    data: {
      periodTokenCount: { increment: tokens },
      periodEstimatedCostCents: { increment: cents },
    },
  });
}
