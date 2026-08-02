import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { can, type Permission } from "@/lib/rbac";
import type { OrgContext } from "@/lib/org-context";
import { audit } from "@/lib/audit";
import { conversationAccessWhere } from "@/lib/services/conversations";
import { createTask } from "@/lib/services/tasks";

/**
 * Deterministic typed tool runtime — the FOUNDATION, kept deliberately
 * narrow in Slice 4.
 *
 * Every rule the model must never break is enforced here, not in prompts:
 * - deny by default: only registered tool names execute, everything else is
 *   refused and audited;
 * - Zod-validated input, RBAC permission, and record-level conversation
 *   scope checked before any effect;
 * - mutating tools run only from an explicit HUMAN action (the model never
 *   calls this runtime directly in this slice — staff buttons do);
 * - deterministic local idempotency for the one mutating tool;
 * - no secrets, no arbitrary database access, no integrations.
 */

type ToolDefinition<TInput, TOutput> = {
  name: string;
  permission: Permission;
  mutating: boolean;
  inputSchema: z.ZodType<TInput>;
  execute: (ctx: OrgContext, input: TInput) => Promise<TOutput>;
};

const proposeFollowUpTask: ToolDefinition<
  { conversationId: string; title: string },
  { taskId: string; deduplicated: boolean }
> = {
  name: "propose_follow_up_task",
  permission: "tasks:manage",
  mutating: true,
  inputSchema: z.object({
    conversationId: z.string().min(1),
    title: z.string().min(1).max(120),
  }),
  execute: async (ctx, input) => {
    // Deterministic idempotency: an identical OPEN follow-up on the same
    // conversation is reused, never duplicated.
    const existing = await prisma.task.findFirst({
      where: {
        organisationId: ctx.organisation.id,
        conversationId: input.conversationId,
        title: input.title,
        status: "OPEN",
      },
      select: { id: true },
    });
    if (existing) return { taskId: existing.id, deduplicated: true };
    const task = await createTask(ctx, {
      title: input.title,
      conversationId: input.conversationId,
    });
    return { taskId: task.id, deduplicated: false };
  },
};

const REGISTRY: Record<string, ToolDefinition<never, unknown>> = {
  [proposeFollowUpTask.name]:
    proposeFollowUpTask as unknown as ToolDefinition<never, unknown>,
};

export async function runTool(
  ctx: OrgContext,
  name: string,
  rawInput: unknown,
): Promise<unknown> {
  const tool = REGISTRY[name];
  if (!tool) {
    await audit(ctx, {
      eventType: "ai.tool.refused",
      targetType: "Tool",
      targetId: name.slice(0, 100),
      after: { reason: "unregistered" },
    });
    throw new Error(`Unknown tool: ${name}`);
  }
  if (!can(ctx.membership.role, tool.permission)) {
    await audit(ctx, {
      eventType: "ai.tool.refused",
      targetType: "Tool",
      targetId: name,
      after: { reason: "permission", permission: tool.permission },
    });
    throw new Error(`Missing permission: ${tool.permission}`);
  }
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    await audit(ctx, {
      eventType: "ai.tool.refused",
      targetType: "Tool",
      targetId: name,
      after: { reason: "invalid_input" },
    });
    throw new Error("Invalid tool input");
  }
  // Record-level conversation scope for any tool that names a conversation.
  const conversationId = (parsed.data as { conversationId?: string }).conversationId;
  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { ...conversationAccessWhere(ctx), id: conversationId },
      select: { id: true },
    });
    if (!conversation) throw new Error("Conversation not found");
  }

  const result = await tool.execute(ctx, parsed.data as never);
  await audit(ctx, {
    eventType: "ai.tool.executed",
    targetType: "Tool",
    targetId: name,
    after: { conversationId: conversationId ?? null },
  });
  return result;
}
