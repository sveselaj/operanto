import "server-only";
import type { AIAction, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { scope, type OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { AIError, type AITaskDefinition } from "@/lib/ai/types";
import {
  COMPUTER_AI_TASKS,
  describeComputerInput,
  type ComputerAIInput,
  type ComputerAiTaskType,
  type ComputerUnderstandOutput,
} from "@/lib/ai/computer-tasks";
import { groundUnderstanding } from "@/lib/computer/grounding";
import { computerGuideEnabled } from "@/lib/computer-flag";
import { providerFor } from "@/lib/services/ai";
import { finalizeAiUsage, reserveAiUsage } from "@/lib/services/ai-config";

/**
 * Computer C3 — page understanding + guide mode on the EXISTING Intelligence
 * spine: same provider abstraction, same per-organisation configuration and
 * budget accounting, same AIAction record, same mock-default behavior.
 *
 * Invocation is always EXPLICIT: a human asks. Capturing a snapshot never
 * triggers analysis; there is no background or continuous model reading of
 * browsing activity.
 *
 * Between the provider result and persistence sits deterministic grounding
 * (src/lib/computer/grounding.ts): unverifiable claims are removed, targets
 * are bound to observed elements or stripped, confidence is capped on any
 * removal. What is persisted and shown is the GROUNDED output.
 *
 * Output is guidance for the HUMAN. Nothing here — and nothing reachable
 * from here — can act on the observed page.
 */

const TASK_TIMEOUT_MS = 30_000;
const MAX_QUESTION_LENGTH = 400;

export async function runComputerAiTask(
  ctx: OrgContext,
  sessionId: string,
  taskType: ComputerAiTaskType,
  options: { question?: string } = {},
): Promise<AIAction> {
  requirePermission(ctx.membership.role, "ai:run");
  requirePermission(ctx.membership.role, "computer:read");
  if (!computerGuideEnabled()) {
    throw new AIError("NOT_CONFIGURED", "Computer guide mode is not enabled");
  }

  const question = options.question?.trim() || null;
  if (question && question.length > MAX_QUESTION_LENGTH) {
    throw new Error(`Question must be at most ${MAX_QUESTION_LENGTH} characters`);
  }

  const session = await prisma.computerSession.findFirst({
    where: { ...scope(ctx), id: sessionId },
    include: {
      customer: { select: { id: true, name: true, restrictedAt: true, erasedAt: true } },
      conversation: { select: { id: true, subject: true } },
      task: { select: { title: true } },
    },
  });
  if (!session) throw new Error("Computer session not found");
  if (session.customer?.restrictedAt) {
    // Art. 18 blocks reads FOR AI PROCESSING, not just writes.
    throw new AIError(
      "PROCESSING_RESTRICTED",
      "Processing for this customer is restricted (GDPR Art. 18)",
    );
  }
  if (session.customer?.erasedAt) {
    throw new AIError("PROCESSING_RESTRICTED", "This customer has been erased");
  }

  const snapshot = await prisma.computerSnapshot.findFirst({
    where: { ...scope(ctx), sessionId: session.id, redactedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!snapshot) {
    throw new Error("The session has no snapshot to analyze — capture a page first");
  }

  const input: ComputerAIInput = {
    goal: session.goal,
    question,
    customerName: session.customer?.name ?? null,
    conversationSubject: session.conversation?.subject ?? null,
    taskTitle: session.task?.title ?? null,
    snapshot: {
      url: snapshot.url,
      pageTitle: snapshot.pageTitle,
      visibleText: snapshot.visibleTextSummary,
      elements: Array.isArray(snapshot.semanticJson)
        ? (snapshot.semanticJson as { role: string; name: string }[])
        : [],
    },
  };

  const task = COMPUTER_AI_TASKS[taskType] as unknown as AITaskDefinition<
    ComputerAIInput,
    ComputerUnderstandOutput
  >;

  let config;
  try {
    config = await reserveAiUsage(ctx, taskType);
  } catch (error) {
    if (error instanceof AIError) {
      await audit(ctx, {
        eventType:
          error.code === "BUDGET_EXHAUSTED"
            ? "ai.budget.blocked"
            : "computer.understanding.failed",
        targetType: "ComputerSession",
        targetId: session.id,
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
      conversationId: session.conversationId,
      customerId: session.customerId,
      computerSessionId: session.id,
      computerSnapshotId: snapshot.id,
      requestedByMembershipId: ctx.membership.id,
      provider: provider.name,
      model,
      taskType,
      promptVersion: task.promptVersion,
      status: "PENDING",
      // Counts and flags only — the observation itself stays exactly once,
      // on the referenced ComputerSnapshot.
      inputSummary: describeComputerInput(input) as Prisma.InputJsonValue,
    },
  });
  await audit(ctx, {
    eventType: "computer.understanding.requested",
    targetType: "AIAction",
    targetId: action.id,
    after: {
      computerSessionId: session.id,
      computerSnapshotId: snapshot.id,
      taskType,
      provider: provider.name,
      model,
    },
  });

  let result;
  try {
    result = await provider.executeTask(task, input, {
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
      eventType: "computer.understanding.failed",
      targetType: "AIAction",
      targetId: action.id,
      after: { computerSessionId: session.id, taskType, errorCode: code },
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

  // Deterministic grounding BEFORE persistence: what we store and show is
  // only what survived verification against the snapshot.
  const { output: grounded, report } = groundUnderstanding(result.data, {
    url: snapshot.url,
    pageTitle: snapshot.pageTitle,
    visibleTextSummary: snapshot.visibleTextSummary,
    elements: input.snapshot.elements,
  });

  const completed = await prisma.$transaction(async (tx) => {
    await tx.aIAction.updateMany({
      where: {
        ...scope(ctx),
        computerSessionId: session.id,
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
        outputJson: { ...grounded, grounding: report } as Prisma.InputJsonValue,
        usageJson: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          estimatedCostCents: result.usage.estimatedCostCents,
          estimated: true,
        },
        providerRequestId: result.providerRequestId,
        confidence: grounded.confidence,
        completedAt: new Date(),
      },
    });
    if (session.conversationId) {
      await tx.activity.create({
        data: {
          organisationId: ctx.organisation.id,
          conversationId: session.conversationId,
          customerId: session.customerId,
          actorType: "STAFF",
          actorUserId: ctx.user.id,
          actorMembershipId: ctx.membership.id,
          activityType: "computer.understanding.completed",
          summary:
            taskType === "COMPUTER_GUIDE"
              ? "Computer guidance generated"
              : "Computer page understanding generated",
          metadata: { aiActionId: action.id, computerSessionId: session.id },
        },
      });
    }
    return completed;
  });

  await audit(ctx, {
    eventType: "computer.understanding.completed",
    targetType: "AIAction",
    targetId: action.id,
    after: {
      computerSessionId: session.id,
      computerSnapshotId: snapshot.id,
      taskType,
      provider: result.provider,
      model: result.model,
      confidence: grounded.confidence,
      factsRemoved: report.factsRemoved,
      target: report.target,
    },
  });
  return completed;
}

/** Latest computer understandings for a session the caller can read. */
export async function listComputerUnderstandings(
  ctx: OrgContext,
  sessionId: string,
) {
  requirePermission(ctx.membership.role, "ai:read");
  requirePermission(ctx.membership.role, "computer:read");
  return prisma.aIAction.findMany({
    where: {
      ...scope(ctx),
      computerSessionId: sessionId,
      taskType: { in: ["COMPUTER_PAGE_UNDERSTAND", "COMPUTER_GUIDE"] },
    },
    orderBy: { createdAt: "desc" },
    take: 6,
    include: { requestedBy: { include: { user: { select: { name: true } } } } },
  });
}
