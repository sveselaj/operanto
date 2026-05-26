import "server-only";
import type { AutomationTrigger, Conversation, Priority, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { WorkspaceContext } from "@/lib/workspace";
import {
  automationConfigSchema,
  conditionSchema,
  actionSchema,
  type Action,
  type Condition,
} from "@/lib/automations/schema";

// ── CRUD ──────────────────────────────────────────────────────
export async function listAutomations(ctx: WorkspaceContext) {
  requirePermission(ctx.member.role, "automations:manage");
  return prisma.automation.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: { createdAt: "asc" },
  });
}

export type AutomationInput = {
  name: string;
  trigger: AutomationTrigger;
  conditions: Condition[];
  actions: Action[];
};

function validateConfig(input: AutomationInput) {
  const parsed = automationConfigSchema.safeParse({
    conditions: input.conditions,
    actions: input.actions,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid automation");
  if (!input.name.trim()) throw new Error("Name is required");
  return parsed.data;
}

export async function createAutomation(ctx: WorkspaceContext, input: AutomationInput) {
  requirePermission(ctx.member.role, "automations:manage");
  const config = validateConfig(input);
  const a = await prisma.automation.create({
    data: {
      workspaceId: ctx.workspace.id,
      name: input.name.trim(),
      trigger: input.trigger,
      conditions: config.conditions as unknown as Prisma.InputJsonValue,
      actions: config.actions as unknown as Prisma.InputJsonValue,
      createdByUserId: ctx.userId,
    },
  });
  await audit(ctx, { action: "automation.create", entity: "Automation", entityId: a.id });
  return a;
}

export async function updateAutomation(
  ctx: WorkspaceContext,
  id: string,
  input: AutomationInput,
) {
  requirePermission(ctx.member.role, "automations:manage");
  await assertAutomation(ctx, id);
  const config = validateConfig(input);
  const a = await prisma.automation.update({
    where: { id },
    data: {
      name: input.name.trim(),
      trigger: input.trigger,
      conditions: config.conditions as unknown as Prisma.InputJsonValue,
      actions: config.actions as unknown as Prisma.InputJsonValue,
    },
  });
  await audit(ctx, { action: "automation.update", entity: "Automation", entityId: id });
  return a;
}

export async function setAutomationEnabled(ctx: WorkspaceContext, id: string, enabled: boolean) {
  requirePermission(ctx.member.role, "automations:manage");
  await assertAutomation(ctx, id);
  await prisma.automation.update({ where: { id }, data: { enabled } });
  await audit(ctx, {
    action: enabled ? "automation.enable" : "automation.disable",
    entity: "Automation",
    entityId: id,
  });
}

export async function deleteAutomation(ctx: WorkspaceContext, id: string) {
  requirePermission(ctx.member.role, "automations:manage");
  await assertAutomation(ctx, id);
  await prisma.automation.delete({ where: { id } });
  await audit(ctx, { action: "automation.delete", entity: "Automation", entityId: id });
}

async function assertAutomation(ctx: WorkspaceContext, id: string) {
  const a = await prisma.automation.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    select: { id: true },
  });
  if (!a) throw new Error("Automation not found");
}

// ── Rule engine ───────────────────────────────────────────────

/** Lightweight context for running automations — no user required (webhooks). */
export type AutomationRunCtx = { workspaceId: string; actorUserId: string | null };

type EvalContext = { conversation: Conversation; messageBody?: string | null };

function matches(conditions: Condition[], evalCtx: EvalContext): boolean {
  const c = evalCtx.conversation;
  return conditions.every((cond) => {
    switch (cond.field) {
      case "intent":
        return c.intent === cond.value;
      case "sentiment":
        return c.sentiment === cond.value;
      case "channelType":
        return c.channelType === cond.value;
      case "leadScoreGte":
        return (c.leadScore ?? 0) >= cond.value;
      case "messageContains": {
        const hay = (evalCtx.messageBody ?? c.summary ?? c.subject ?? "").toLowerCase();
        return hay.includes(cond.value.toLowerCase());
      }
      default:
        return false;
    }
  });
}

/** Execute one action against a conversation. Idempotent where possible. */
async function execAction(
  run: AutomationRunCtx,
  action: Action,
  conversation: Conversation,
): Promise<string | null> {
  const wId = run.workspaceId;
  switch (action.type) {
    case "add_tag": {
      const tag = await prisma.tag.findFirst({ where: { id: action.tagId, workspaceId: wId } });
      if (!tag) return null;
      await prisma.conversationTag.upsert({
        where: { conversationId_tagId: { conversationId: conversation.id, tagId: tag.id } },
        create: { conversationId: conversation.id, tagId: tag.id },
        update: {},
      });
      return `tagged ${tag.name}`;
    }
    case "set_priority": {
      if (conversation.priority === action.priority) return null;
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { priority: action.priority as Priority },
      });
      return `priority ${action.priority}`;
    }
    case "assign": {
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: wId, userId: action.userId } },
      });
      if (!member) return null;
      if (conversation.assignedToUserId === action.userId) return null;
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { assignedToUserId: action.userId },
      });
      return "assigned";
    }
    case "create_task": {
      // Idempotent: skip if an open task with the same title is already linked.
      const existing = await prisma.task.findFirst({
        where: {
          workspaceId: wId,
          linkedConversationId: conversation.id,
          title: action.title,
          status: { in: ["todo", "in_progress"] },
        },
        select: { id: true },
      });
      if (existing) return null;
      await prisma.task.create({
        data: {
          workspaceId: wId,
          title: action.title,
          status: "todo",
          priority: conversation.priority,
          linkedConversationId: conversation.id,
          linkedCustomerId: conversation.customerId,
          createdByUserId: run.actorUserId,
        },
      });
      return "task created";
    }
    default:
      return null;
  }
}

function parseConditions(raw: unknown): Condition[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    const p = conditionSchema.safeParse(c);
    return p.success ? [p.data] : [];
  });
}
function parseActions(raw: unknown): Action[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((a) => {
    const p = actionSchema.safeParse(a);
    return p.success ? [p.data] : [];
  });
}

/**
 * Run all enabled automations for a trigger against one conversation.
 * Executes with workspace authority (not the caller's per-action permissions),
 * since automations are workspace-configured rules.
 */
export async function runAutomationsForConversation(
  run: AutomationRunCtx,
  trigger: AutomationTrigger,
  conversationId: string,
  messageBody?: string | null,
): Promise<number> {
  const automations = await prisma.automation.findMany({
    where: { workspaceId: run.workspaceId, trigger, enabled: true },
  });
  if (automations.length === 0) return 0;

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: run.workspaceId },
  });
  if (!conversation) return 0;

  let appliedCount = 0;
  for (const a of automations) {
    const conditions = parseConditions(a.conditions);
    if (!matches(conditions, { conversation, messageBody })) continue;

    const actions = parseActions(a.actions);
    const applied: string[] = [];
    // Reload conversation between actions so each sees prior mutations.
    let current = conversation;
    for (const action of actions) {
      const result = await execAction(run, action, current);
      if (result) applied.push(result);
      const refreshed = await prisma.conversation.findUnique({ where: { id: conversationId } });
      if (refreshed) current = refreshed;
    }

    await prisma.automation.update({ where: { id: a.id }, data: { lastRunAt: new Date() } });
    if (applied.length > 0) {
      appliedCount++;
      await prisma.auditLog.create({
        data: {
          workspaceId: run.workspaceId,
          actorUserId: run.actorUserId,
          action: "automation.run",
          entity: "Automation",
          entityId: a.id,
          after: { conversationId, applied },
        },
      });
    }
  }
  return appliedCount;
}

/** Manually run a single automation across all matching conversations. */
export async function runAutomationNow(ctx: WorkspaceContext, id: string): Promise<number> {
  requirePermission(ctx.member.role, "automations:manage");
  const automation = await prisma.automation.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
  });
  if (!automation) throw new Error("Automation not found");

  const run: AutomationRunCtx = { workspaceId: ctx.workspace.id, actorUserId: ctx.userId };
  const conditions = parseConditions(automation.conditions);
  const actions = parseActions(automation.actions);
  const conversations = await prisma.conversation.findMany({
    where: { workspaceId: ctx.workspace.id },
    take: 500,
  });

  let affected = 0;
  for (const conv of conversations) {
    if (!matches(conditions, { conversation: conv })) continue;
    let current = conv;
    let any = false;
    for (const action of actions) {
      const result = await execAction(run, action, current);
      if (result) any = true;
      const refreshed = await prisma.conversation.findUnique({ where: { id: conv.id } });
      if (refreshed) current = refreshed;
    }
    if (any) affected++;
  }
  await prisma.automation.update({ where: { id }, data: { lastRunAt: new Date() } });
  await audit(ctx, {
    action: "automation.runNow",
    entity: "Automation",
    entityId: id,
    after: { affected },
  });
  return affected;
}
