import "server-only";
import { z } from "zod";
import { createTask } from "@/lib/services/tasks";
import type { ToolDefinition } from "@/lib/tools/types";

const taskRow = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  dueAt: z.string().nullable(),
});

// ── create_task ───────────────────────────────────────────────
export const createTaskTool: ToolDefinition = {
  name: "create_task",
  title: "Create task",
  description: "Create an internal task, optionally linked to a conversation or contact.",
  category: "tasks",
  risk: "write",
  permission: "tasks:manage",
  approval: "none",
  card: "task.detail",
  inputSchema: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    dueInDays: z.number().int().min(0).max(365).optional(),
    linkedConversationId: z.string().optional(),
    linkedCustomerId: z.string().optional(),
  }),
  outputSchema: z.object({ task: taskRow }),
  async execute(exec, input) {
    const task = await createTask(exec.ctx, {
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      dueAt:
        typeof input.dueInDays === "number"
          ? new Date(Date.now() + input.dueInDays * 86_400_000)
          : null,
      linkedConversationId: input.linkedConversationId ?? null,
      linkedCustomerId: input.linkedCustomerId ?? null,
    });
    return {
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt ? task.dueAt.toISOString() : null,
      },
    };
  },
  summarize: (out) => `Created task "${out.task.title}".`,
};

// ── create_follow_up ──────────────────────────────────────────
export const createFollowUpTool: ToolDefinition = {
  name: "create_follow_up",
  title: "Create follow-up",
  description: "Create a dated follow-up task for a contact or conversation.",
  category: "tasks",
  risk: "write",
  permission: "tasks:manage",
  approval: "none",
  card: "task.detail",
  inputSchema: z.object({
    title: z.string().min(1),
    dueInDays: z.number().int().min(0).max(365).default(1),
    linkedConversationId: z.string().optional(),
    linkedCustomerId: z.string().optional(),
  }),
  outputSchema: z.object({ task: taskRow }),
  async execute(exec, input) {
    const task = await createTask(exec.ctx, {
      title: input.title,
      priority: "normal",
      dueAt: new Date(Date.now() + input.dueInDays * 86_400_000),
      linkedConversationId: input.linkedConversationId ?? null,
      linkedCustomerId: input.linkedCustomerId ?? null,
    });
    return {
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt ? task.dueAt.toISOString() : null,
      },
    };
  },
  summarize: (out) => `Scheduled follow-up "${out.task.title}".`,
};
