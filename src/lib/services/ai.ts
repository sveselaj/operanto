import "server-only";
import type { AIAction, AIRiskLevel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { AIError, type AIProvider, type AITaskDefinition } from "@/lib/ai/types";
import { AI_TASKS, type ConversationAIInput } from "@/lib/ai/tasks";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { OpenAIProvider } from "@/lib/ai/openai-provider";
import { buildConversationAIInput, describeInput } from "@/lib/ai/context";
import { isLowConfidence } from "@/lib/ai/policy";
import { conversationAccessWhere } from "@/lib/services/conversations";
import {
  finalizeAiUsage,
  liveModeEnabledForDeployment,
  reserveAiUsage,
} from "@/lib/services/ai-config";

/**
 * AI orchestration (Operanto Intelligence, Slice 4).
 *
 * One entry point runs one registered task against one conversation the
 * caller can access. Output is persisted as an AIAction and — for reply
 * drafts — parked behind an ApprovalRequest. Nothing here sends anything
 * anywhere: approval admits a draft into the MANUAL message flow only.
 *
 * AI failure never blocks manual conversation handling: every failure is a
 * normalized error plus a FAILED AIAction row, and the conversation services
 * are untouched by any of it.
 */

const TASK_TIMEOUT_MS = 30_000;

/** The four conversation-bound tasks this module runs (COMPUTER_* tasks run
 *  through src/lib/services/computer-understanding.ts on the same spine). */
type ConversationTaskType = keyof typeof AI_TASKS;

const AUDIT_EVENT: Record<ConversationTaskType, { requested: string; completed: string }> = {
  SUMMARY: { requested: "ai.summary.requested", completed: "ai.summary.completed" },
  CLASSIFICATION: {
    requested: "ai.classification.requested",
    completed: "ai.classification.completed",
  },
  REPLY_DRAFT: {
    requested: "ai.reply_draft.requested",
    completed: "ai.reply_draft.completed",
  },
  NEXT_ACTION: {
    requested: "ai.next_action.requested",
    completed: "ai.next_action.completed",
  },
};

/** Provider selection — shared with the Computer understanding service. */
export function providerFor(config: { mode: string; provider: string }): AIProvider {
  if (config.mode === "LIVE" && liveModeEnabledForDeployment()) {
    if (config.provider === "openai") return new OpenAIProvider();
    // Unknown live provider names refuse rather than silently mocking.
    throw new AIError("NOT_CONFIGURED", `Unknown AI provider: ${config.provider}`);
  }
  return new MockAIProvider();
}

export async function runAiTask(
  ctx: OrgContext,
  conversationId: string,
  taskType: ConversationTaskType,
): Promise<AIAction> {
  requirePermission(ctx.membership.role, "ai:run");
  // Type-erased view of the registry entry: outputs are handled generically
  // (validated by each task's own schema inside the provider).
  const task = AI_TASKS[taskType] as unknown as AITaskDefinition<
    ConversationAIInput,
    Record<string, unknown>
  >;

  // Record-level access + restriction enforcement live in the builder; both
  // fire before any configuration or provider work.
  let built;
  try {
    built = await buildConversationAIInput(ctx, conversationId);
  } catch (error) {
    if (error instanceof AIError) {
      await audit(ctx, {
        eventType: "ai.action.failed",
        targetType: "Conversation",
        targetId: conversationId,
        after: { taskType, errorCode: error.code },
      });
    }
    throw error;
  }

  let config;
  try {
    config = await reserveAiUsage(ctx, taskType);
  } catch (error) {
    if (error instanceof AIError) {
      await audit(ctx, {
        eventType:
          error.code === "BUDGET_EXHAUSTED" ? "ai.budget.blocked" : "ai.action.failed",
        targetType: "Conversation",
        targetId: conversationId,
        after: { taskType, errorCode: error.code },
      });
    }
    throw error;
  }

  const provider = providerFor(config);
  const model =
    provider.name === "mock"
      ? "mock"
      : config.model || process.env.OPERANTO_AI_DEFAULT_MODEL || "gpt-4o-mini";

  const action = await prisma.aIAction.create({
    data: {
      organisationId: ctx.organisation.id,
      conversationId: built.conversationId,
      customerId: built.customerId,
      requestedByMembershipId: ctx.membership.id,
      provider: provider.name,
      model,
      taskType,
      promptVersion: task.promptVersion,
      status: "PENDING",
      inputSummary: describeInput(built.input) as Prisma.InputJsonValue,
    },
  });
  await audit(ctx, {
    eventType: AUDIT_EVENT[taskType].requested,
    targetType: "AIAction",
    targetId: action.id,
    after: { conversationId, taskType, provider: provider.name, model },
  });

  let result;
  try {
    result = await provider.executeTask(task, built.input, {
      organisationId: ctx.organisation.id,
      model,
      timeoutMs: TASK_TIMEOUT_MS,
    });
  } catch (error) {
    const code = error instanceof AIError ? error.code : "PROVIDER_ERROR";
    await prisma.aIAction.update({
      where: { id: action.id },
      data: { status: "FAILED", errorCode: code, completedAt: new Date() },
    });
    await audit(ctx, {
      eventType: "ai.action.failed",
      targetType: "AIAction",
      targetId: action.id,
      after: { conversationId, taskType, errorCode: code },
    });
    throw error instanceof AIError
      ? error
      : new AIError("PROVIDER_ERROR", "AI provider failed");
  }

  await finalizeAiUsage(
    ctx.organisation.id,
    result.model,
    result.usage.inputTokens,
    result.usage.outputTokens,
  );

  const output = result.data as Record<string, unknown>;
  const confidence =
    typeof output.confidence === "number" ? output.confidence : null;
  const riskLevel =
    taskType === "REPLY_DRAFT" || taskType === "CLASSIFICATION"
      ? ((output.riskCategory as AIRiskLevel | undefined) ?? null)
      : null;

  const completed = await prisma.$transaction(async (tx) => {
    // A fresh result supersedes previous completed results of the same kind
    // on the same conversation.
    await tx.aIAction.updateMany({
      where: {
        ...scope(ctx),
        conversationId: built.conversationId,
        taskType,
        status: "COMPLETED",
        id: { not: action.id },
      },
      data: { status: "SUPERSEDED" },
    });

    const completed = await tx.aIAction.update({
      where: { id: action.id },
      data: {
        status: "COMPLETED",
        outputJson: output as Prisma.InputJsonValue,
        usageJson: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          estimatedCostCents: result.usage.estimatedCostCents,
          estimated: true,
        },
        providerRequestId: result.providerRequestId,
        confidence,
        riskLevel,
        completedAt: new Date(),
      },
    });

    if (taskType === "REPLY_DRAFT") {
      // Regeneration cancels the previous pending gate for this conversation.
      await tx.approvalRequest.updateMany({
        where: {
          ...scope(ctx),
          conversationId: built.conversationId,
          sourceType: "AI_REPLY_DRAFT",
          status: "PENDING",
        },
        data: { status: "CANCELLED", decidedAt: new Date() },
      });
      await tx.approvalRequest.create({
        data: {
          organisationId: ctx.organisation.id,
          conversationId: built.conversationId,
          sourceType: "AI_REPLY_DRAFT",
          sourceId: action.id,
          actionType: "conversation.record_manual_reply",
          requestedByMembershipId: ctx.membership.id,
          originalPayload: { reply: output.reply } as Prisma.InputJsonValue,
          riskLevel: (riskLevel ?? "MEDIUM") as AIRiskLevel,
          lowConfidence: isLowConfidence(confidence),
          idempotencyKey: action.id,
        },
      });
    }

    await tx.activity.create({
      data: {
        organisationId: ctx.organisation.id,
        conversationId: built.conversationId,
        customerId: built.customerId,
        actorType: "STAFF",
        actorUserId: ctx.user.id,
        actorMembershipId: ctx.membership.id,
        activityType: AUDIT_EVENT[taskType].completed,
        summary:
          taskType === "SUMMARY"
            ? "AI summary generated"
            : taskType === "CLASSIFICATION"
              ? "AI classification generated"
              : taskType === "REPLY_DRAFT"
                ? "AI reply draft generated (awaiting review)"
                : "AI next-action recommendation generated",
        metadata: { aiActionId: action.id },
      },
    });
    return completed;
  });

  await audit(ctx, {
    eventType: AUDIT_EVENT[taskType].completed,
    targetType: "AIAction",
    targetId: action.id,
    after: {
      conversationId,
      taskType,
      provider: result.provider,
      model: result.model,
      confidence,
      riskLevel,
    },
  });
  return completed;
}

/** Latest AI results for a conversation the caller can access. */
export async function listAiActions(ctx: OrgContext, conversationId: string) {
  requirePermission(ctx.membership.role, "ai:read");
  const conversation = await prisma.conversation.findFirst({
    where: { ...conversationAccessWhere(ctx), id: conversationId },
    select: { id: true },
  });
  if (!conversation) throw new Error("Conversation not found");
  return prisma.aIAction.findMany({
    where: {
      ...scope(ctx),
      conversationId,
      // The conversation panel shows conversation tasks; COMPUTER_* results
      // (which may share a conversationId via their session) live in the
      // Computer workbench.
      taskType: { in: ["SUMMARY", "CLASSIFICATION", "REPLY_DRAFT", "NEXT_ACTION"] },
    },
    orderBy: { createdAt: "desc" },
    take: 12,
    include: {
      requestedBy: { include: { user: { select: { name: true } } } },
    },
  });
}
