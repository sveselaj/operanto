import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import type { WorkspaceContext } from "@/lib/workspace";
import { getProvider, modelFor } from "@/lib/ai/config";
import { AIProviderError } from "@/lib/ai/provider";
import type { AITaskDef } from "@/lib/ai/tasks";

export type AIRunResult<O> = {
  data: O;
  confidence: number | null;
  model: string;
  aiActionId: string;
};

/** Anthropic requires a plain object JSON schema; drop metadata keys. */
function toToolSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function trimInput(input: unknown): object {
  const i = input as Record<string, unknown>;
  const messages = Array.isArray(i?.messages) ? i.messages : [];
  return {
    channel: i?.channel,
    subject: i?.subject,
    customerName: i?.customerName,
    instruction: i?.instruction,
    messageCount: messages.length,
  };
}

/**
 * Run an AI task: route to the right model, get structured output (or a mock in
 * mock mode), validate it, and log an AIAction. AI output is always a
 * suggestion — callers decide whether/how to apply it (human in the loop).
 */
export async function runAITask<I, O>(
  ctx: WorkspaceContext,
  task: AITaskDef<I, O>,
  input: I,
): Promise<AIRunResult<O>> {
  requirePermission(ctx.member.role, "ai:run");

  const provider = getProvider();
  const model = modelFor(task.tier);

  let data: O;
  let usedModel = model;

  try {
    if (!provider) {
      data = task.mock(input);
      usedModel = "mock";
    } else {
      const req = {
        model,
        system: task.system,
        prompt: task.buildPrompt(input),
        tool: {
          name: task.toolName,
          description: task.toolDescription,
          inputSchema: toToolSchema(task.schema),
        },
      };
      let res = await provider.complete(req);
      let parsed = task.schema.safeParse(res.data);
      if (!parsed.success) {
        // One retry — transient malformed output.
        res = await provider.complete(req);
        parsed = task.schema.safeParse(res.data);
      }
      if (!parsed.success) {
        throw new AIProviderError(`Invalid AI output: ${parsed.error.message}`);
      }
      data = parsed.data;
      usedModel = res.model;
    }
  } catch (err) {
    await prisma.aIAction.create({
      data: {
        workspaceId: ctx.workspace.id,
        userId: ctx.userId,
        actionType: task.name,
        inputContext: trimInput(input),
        promptTemplate: `${task.name}@${task.version}`,
        model: usedModel,
        status: "failed",
        output: { error: err instanceof Error ? err.message : "unknown" },
      },
    });
    throw err;
  }

  const confidence =
    typeof (data as { confidence?: unknown }).confidence === "number"
      ? (data as { confidence: number }).confidence
      : null;

  const action = await prisma.aIAction.create({
    data: {
      workspaceId: ctx.workspace.id,
      userId: ctx.userId,
      actionType: task.name,
      inputContext: trimInput(input),
      promptTemplate: `${task.name}@${task.version}`,
      model: usedModel,
      output: data as object,
      confidence,
      status: "suggested",
    },
  });

  return { data, confidence, model: usedModel, aiActionId: action.id };
}
