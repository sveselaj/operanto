import "server-only";
import { Prisma, type ApprovalRequest, type ToolInvocation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { can, ForbiddenError } from "@/lib/rbac";
import type { WorkspaceContext } from "@/lib/workspace";
import { requiresApproval } from "@/lib/tools/policy";
import { getTool } from "@/lib/tools/registry";
import type { CockpitBlock, ToolDefinition, ToolExecutionContext } from "@/lib/tools/types";

const APPROVAL_TTL_MS = 48 * 3_600_000;

export type RunToolOutcome = {
  invocation: ToolInvocation;
  approval: ApprovalRequest | null;
  block: CockpitBlock;
  title: string;
  resultSummary: string;
  awaitingApproval: boolean;
  error: string | null;
};

/** Human summary of a proposed (not-yet-run) action for the approval card. */
function describeProposal(tool: ToolDefinition, input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v == null || typeof v === "object") continue;
    const s = String(v);
    parts.push(`${k}: ${s.length > 80 ? s.slice(0, 80) + "…" : s}`);
    if (parts.length >= 4) break;
  }
  return parts.length ? `${tool.title} — ${parts.join(", ")}` : tool.title;
}

function errorBlock(toolName: string, code: string, message: string): CockpitBlock {
  return { type: "error", code, message, toolName };
}

/**
 * Run a single proposed tool call. The runtime is the SOLE executor and the one
 * place permission + approval are enforced (deny-by-default). Read/draft tools
 * with no approval requirement run immediately; sensitive tools are persisted as
 * `awaiting_approval` with an `ApprovalRequest` and never execute here.
 */
export async function runTool(
  exec: ToolExecutionContext,
  tool: ToolDefinition,
  rawInput: unknown,
  opts: { messageId?: string; idempotencyKey?: string; requestedByUserId?: string } = {},
): Promise<RunToolOutcome> {
  const { ctx, correlationId, threadId } = exec;
  const workspaceId = ctx.workspace.id;
  const base = {
    workspaceId,
    threadId: threadId ?? null,
    messageId: opts.messageId ?? null,
    toolName: tool.name,
    title: tool.title,
    category: tool.category,
    risk: tool.risk,
    correlationId,
  };

  // 1) Validate input against the tool's schema.
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    const invocation = await prisma.toolInvocation.create({
      data: {
        ...base,
        input: (rawInput ?? {}) as Prisma.InputJsonValue,
        status: "failed",
        errorCode: "invalid_input",
        errorMessage: message,
        completedAt: new Date(),
      },
    });
    await audit(ctx, {
      action: "assistant.tool.failed",
      entity: "ToolInvocation",
      entityId: invocation.id,
      correlationId,
      after: { code: "invalid_input" },
    });
    return {
      invocation,
      approval: null,
      block: errorBlock(tool.name, "invalid_input", `Invalid input — ${message}`),
      title: tool.title,
      resultSummary: `invalid input: ${message}`,
      awaitingApproval: false,
      error: message,
    };
  }
  const input = parsed.data as Record<string, unknown>;

  // 2) Permission check — deny by default.
  if (!can(ctx.member.role, tool.permission)) {
    const invocation = await prisma.toolInvocation.create({
      data: {
        ...base,
        input: input as Prisma.InputJsonValue,
        status: "failed",
        errorCode: "forbidden",
        errorMessage: `Missing permission "${tool.permission}"`,
        completedAt: new Date(),
      },
    });
    await audit(ctx, {
      action: "assistant.tool.failed",
      entity: "ToolInvocation",
      entityId: invocation.id,
      correlationId,
      after: { code: "forbidden" },
    });
    return {
      invocation,
      approval: null,
      block: errorBlock(tool.name, "forbidden", "You don't have permission to run that."),
      title: tool.title,
      resultSummary: "not permitted",
      awaitingApproval: false,
      error: "forbidden",
    };
  }

  // 3) Approval gate.
  if (requiresApproval(ctx, tool)) {
    const summary = describeProposal(tool, input);
    const invocation = await createInvocationWithIdempotency(base, input, opts.idempotencyKey, {
      status: "awaiting_approval",
      approvalRequired: true,
    });
    // If an identical proposal already exists (idempotency), reuse its approval.
    const approval =
      (await prisma.approvalRequest.findUnique({ where: { toolInvocationId: invocation.id } })) ??
      (await prisma.approvalRequest.create({
        data: {
          workspaceId,
          toolInvocationId: invocation.id,
          status: "pending",
          title: tool.title,
          summary,
          requestedByUserId: opts.requestedByUserId ?? ctx.userId,
          expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
        },
      }));
    await audit(ctx, {
      action: "assistant.tool.proposed",
      entity: "ToolInvocation",
      entityId: invocation.id,
      correlationId,
    });
    await audit(ctx, {
      action: "approval.requested",
      entity: "ApprovalRequest",
      entityId: approval.id,
      correlationId,
    });
    return {
      invocation,
      approval,
      block: {
        type: "approval",
        approvalId: approval.id,
        invocationId: invocation.id,
        toolName: tool.name,
        title: tool.title,
        summary,
        risk: tool.risk,
        status: approval.status,
        card: tool.card,
        data: input,
      },
      title: tool.title,
      resultSummary: summary,
      awaitingApproval: true,
      error: null,
    };
  }

  // 4) No approval needed — execute now.
  const invocation = await createInvocationWithIdempotency(base, input, opts.idempotencyKey, {
    status: "running",
    approvalRequired: false,
    startedAt: new Date(),
  });
  // Idempotent reuse: a prior completed run with the same key short-circuits.
  if (invocation.status === "completed") {
    return completedOutcome(tool, invocation);
  }
  return executeNow(exec, tool, invocation, input);
}

/** Create a ToolInvocation, reusing an existing row when the idempotency key matches. */
async function createInvocationWithIdempotency(
  base: Record<string, unknown>,
  input: Record<string, unknown>,
  idempotencyKey: string | undefined,
  extra: Partial<Prisma.ToolInvocationUncheckedCreateInput>,
): Promise<ToolInvocation> {
  if (idempotencyKey) {
    const existing = await prisma.toolInvocation.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: base.workspaceId as string,
          idempotencyKey,
        },
      },
    });
    if (existing) return existing;
  }
  try {
    return await prisma.toolInvocation.create({
      data: {
        ...(base as Prisma.ToolInvocationUncheckedCreateInput),
        input: input as Prisma.InputJsonValue,
        idempotencyKey: idempotencyKey ?? null,
        ...extra,
      },
    });
  } catch (e) {
    // Lost a race on the unique key — return the winner.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && idempotencyKey) {
      const existing = await prisma.toolInvocation.findUnique({
        where: {
          workspaceId_idempotencyKey: { workspaceId: base.workspaceId as string, idempotencyKey },
        },
      });
      if (existing) return existing;
    }
    throw e;
  }
}

async function executeNow(
  exec: ToolExecutionContext,
  tool: ToolDefinition,
  invocation: ToolInvocation,
  input: Record<string, unknown>,
): Promise<RunToolOutcome> {
  const { ctx, correlationId } = exec;
  try {
    const output = await tool.execute(exec, input);
    const validated = tool.outputSchema.safeParse(output);
    if (!validated.success) throw new Error("Tool produced an unexpected result shape");
    const summary = safeSummarize(tool, validated.data, input);
    const updated = await prisma.toolInvocation.update({
      where: { id: invocation.id },
      data: {
        status: "completed",
        output: validated.data as Prisma.InputJsonValue,
        resultSummary: summary,
        executedByUserId: ctx.userId,
        completedAt: new Date(),
      },
    });
    await audit(ctx, {
      action: "assistant.tool.executed",
      entity: "ToolInvocation",
      entityId: updated.id,
      correlationId,
      after: { tool: tool.name },
    });
    return {
      invocation: updated,
      approval: null,
      block: {
        type: "tool",
        invocationId: updated.id,
        toolName: tool.name,
        title: tool.title,
        category: tool.category,
        risk: tool.risk,
        status: "completed",
        card: tool.card,
        data: validated.data,
        summary,
      },
      title: tool.title,
      resultSummary: summary,
      awaitingApproval: false,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool execution failed";
    const updated = await prisma.toolInvocation.update({
      where: { id: invocation.id },
      data: { status: "failed", errorCode: "execution_error", errorMessage: message, completedAt: new Date() },
    });
    await audit(ctx, {
      action: "assistant.tool.failed",
      entity: "ToolInvocation",
      entityId: updated.id,
      correlationId,
      after: { code: "execution_error" },
    });
    return {
      invocation: updated,
      approval: null,
      block: errorBlock(tool.name, "execution_error", message),
      title: tool.title,
      resultSummary: `failed: ${message}`,
      awaitingApproval: false,
      error: message,
    };
  }
}

function completedOutcome(tool: ToolDefinition, invocation: ToolInvocation): RunToolOutcome {
  const summary = invocation.resultSummary ?? "Already completed.";
  return {
    invocation,
    approval: null,
    block: {
      type: "tool",
      invocationId: invocation.id,
      toolName: tool.name,
      title: tool.title,
      category: tool.category,
      risk: tool.risk,
      status: "completed",
      card: tool.card,
      data: invocation.output,
      summary,
    },
    title: tool.title,
    resultSummary: summary,
    awaitingApproval: false,
    error: null,
  };
}

function safeSummarize(tool: ToolDefinition, output: unknown, input: unknown): string {
  try {
    return tool.summarize(output, input);
  } catch {
    return "Done.";
  }
}

// ─────────────────────────────────────────────────────────────
// Approval resolution
// ─────────────────────────────────────────────────────────────

export type ApprovalDecisionResult = {
  invocation: ToolInvocation;
  executed: boolean;
  output: unknown | null;
  error: string | null;
};

/**
 * Approve and execute a pending tool invocation. Guarantees SINGLE execution:
 * the `awaiting_approval → running` transition is an atomic conditional update,
 * so a duplicate approval (double-click, retry) finds the row already claimed
 * and returns the prior result instead of running again.
 */
export async function approveInvocation(
  ctx: WorkspaceContext,
  invocationId: string,
  opts: { reviewNote?: string } = {},
): Promise<ApprovalDecisionResult> {
  const workspaceId = ctx.workspace.id;
  const invocation = await prisma.toolInvocation.findFirst({
    where: { id: invocationId, workspaceId },
  });
  if (!invocation) throw new Error("Tool invocation not found");

  // Already resolved → idempotent no-op.
  if (invocation.status === "completed")
    return { invocation, executed: false, output: invocation.output, error: null };
  if (invocation.status === "rejected") throw new Error("This action was already rejected");
  if (invocation.status !== "awaiting_approval")
    throw new Error(`Cannot approve an invocation in status "${invocation.status}"`);

  const tool = getTool(ctx.workspace.vertical, invocation.toolName);
  if (!tool) throw new Error(`Unknown tool "${invocation.toolName}"`);

  // Reviewer must be allowed to review AND to run the underlying tool.
  if (!can(ctx.member.role, "approvals:review")) throw new ForbiddenError("approvals:review");
  if (!can(ctx.member.role, tool.permission)) throw new ForbiddenError(tool.permission);

  // Atomic claim: only one caller flips awaiting_approval → running.
  const claim = await prisma.toolInvocation.updateMany({
    where: { id: invocationId, workspaceId, status: "awaiting_approval" },
    data: { status: "running", startedAt: new Date(), executedByUserId: ctx.userId },
  });
  if (claim.count === 0) {
    const current = await prisma.toolInvocation.findUnique({ where: { id: invocationId } });
    return { invocation: current!, executed: false, output: current?.output ?? null, error: null };
  }

  await prisma.approvalRequest.updateMany({
    where: { toolInvocationId: invocationId, status: "pending" },
    data: {
      status: "approved",
      reviewedByUserId: ctx.userId,
      reviewedAt: new Date(),
      reviewNote: opts.reviewNote ?? null,
    },
  });
  await audit(ctx, {
    action: "approval.approved",
    entity: "ToolInvocation",
    entityId: invocationId,
    correlationId: invocation.correlationId ?? undefined,
  });

  // Re-validate the (possibly edited) stored input and execute.
  const parsed = tool.inputSchema.safeParse(invocation.input);
  if (!parsed.success) {
    const message = "Stored input no longer valid";
    const failed = await prisma.toolInvocation.update({
      where: { id: invocationId },
      data: { status: "failed", errorCode: "invalid_input", errorMessage: message, completedAt: new Date() },
    });
    return { invocation: failed, executed: false, output: null, error: message };
  }

  const exec: ToolExecutionContext = {
    ctx,
    threadId: invocation.threadId,
    correlationId: invocation.correlationId ?? invocationId,
  };
  try {
    const output = await tool.execute(exec, parsed.data);
    const validated = tool.outputSchema.safeParse(output);
    if (!validated.success) throw new Error("Tool produced an unexpected result shape");
    const summary = safeSummarize(tool, validated.data, parsed.data);
    const done = await prisma.toolInvocation.update({
      where: { id: invocationId },
      data: {
        status: "completed",
        output: validated.data as Prisma.InputJsonValue,
        resultSummary: summary,
        completedAt: new Date(),
      },
    });
    await audit(ctx, {
      action: "assistant.tool.executed",
      entity: "ToolInvocation",
      entityId: invocationId,
      correlationId: invocation.correlationId ?? undefined,
      after: { tool: tool.name },
    });
    return { invocation: done, executed: true, output: validated.data, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool execution failed";
    const failed = await prisma.toolInvocation.update({
      where: { id: invocationId },
      data: { status: "failed", errorCode: "execution_error", errorMessage: message, completedAt: new Date() },
    });
    await audit(ctx, {
      action: "assistant.tool.failed",
      entity: "ToolInvocation",
      entityId: invocationId,
      correlationId: invocation.correlationId ?? undefined,
      after: { code: "execution_error" },
    });
    return { invocation: failed, executed: false, output: null, error: message };
  }
}

/** Reject a pending invocation. Never executes. Idempotent. */
export async function rejectInvocation(
  ctx: WorkspaceContext,
  invocationId: string,
  opts: { reviewNote?: string } = {},
): Promise<ToolInvocation> {
  if (!can(ctx.member.role, "approvals:review")) throw new ForbiddenError("approvals:review");
  const workspaceId = ctx.workspace.id;
  const invocation = await prisma.toolInvocation.findFirst({
    where: { id: invocationId, workspaceId },
  });
  if (!invocation) throw new Error("Tool invocation not found");
  if (invocation.status !== "awaiting_approval") return invocation; // already resolved

  const claim = await prisma.toolInvocation.updateMany({
    where: { id: invocationId, workspaceId, status: "awaiting_approval" },
    data: { status: "rejected", completedAt: new Date() },
  });
  if (claim.count === 0) return (await prisma.toolInvocation.findUnique({ where: { id: invocationId } }))!;

  await prisma.approvalRequest.updateMany({
    where: { toolInvocationId: invocationId, status: "pending" },
    data: {
      status: "rejected",
      reviewedByUserId: ctx.userId,
      reviewedAt: new Date(),
      reviewNote: opts.reviewNote ?? null,
    },
  });
  await audit(ctx, {
    action: "approval.rejected",
    entity: "ToolInvocation",
    entityId: invocationId,
    correlationId: invocation.correlationId ?? undefined,
  });
  return (await prisma.toolInvocation.findUnique({ where: { id: invocationId } }))!;
}

/** Edit the stored input of a pending invocation before approval (e.g. tweak a reply body). */
export async function updateInvocationInput(
  ctx: WorkspaceContext,
  invocationId: string,
  patch: Record<string, unknown>,
): Promise<ToolInvocation> {
  if (!can(ctx.member.role, "approvals:review")) throw new ForbiddenError("approvals:review");
  const workspaceId = ctx.workspace.id;
  const invocation = await prisma.toolInvocation.findFirst({
    where: { id: invocationId, workspaceId, status: "awaiting_approval" },
  });
  if (!invocation) throw new Error("Editable pending invocation not found");
  const tool = getTool(ctx.workspace.vertical, invocation.toolName);
  if (!tool) throw new Error(`Unknown tool "${invocation.toolName}"`);
  const merged = { ...(invocation.input as object), ...patch };
  const parsed = tool.inputSchema.safeParse(merged);
  if (!parsed.success) throw new Error("Edited input is invalid");
  const updated = await prisma.toolInvocation.update({
    where: { id: invocationId },
    data: { input: parsed.data as Prisma.InputJsonValue },
  });
  await audit(ctx, {
    action: "approval.edited",
    entity: "ToolInvocation",
    entityId: invocationId,
    correlationId: invocation.correlationId ?? undefined,
  });
  return updated;
}
