import "server-only";
import { z } from "zod";
import {
  AIError,
  type AIExecutionContext,
  type AIProvider,
  type AIProviderResult,
  type AITaskDefinition,
} from "@/lib/ai/types";
import { estimateCostCents } from "@/lib/ai/policy";

/**
 * OpenAI adapter — the initial production provider, entirely behind the
 * provider-neutral interface. Uses the chat completions API with strict
 * structured outputs (json_schema), a hard timeout, Zod validation with one
 * retry on malformed output, and normalized errors. Never logs prompt or
 * completion content; captures usage numbers only.
 *
 * The API key is deployment-level (`OPENAI_API_KEY`) — per-tenant credentials
 * are deliberately out of scope for this slice and documented as such.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";

  async executeTask<TInput, TOutput>(
    task: AITaskDefinition<TInput, TOutput>,
    input: TInput,
    context: AIExecutionContext,
  ): Promise<AIProviderResult<TOutput>> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new AIError("NOT_CONFIGURED", "OPENAI_API_KEY is not configured");
    }

    const schema = z.toJSONSchema(task.schema) as Record<string, unknown>;
    delete schema.$schema;

    const call = async () => {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: context.model,
          messages: [
            { role: "system", content: task.system },
            { role: "user", content: task.buildPrompt(input) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: task.name, strict: true, schema },
          },
        }),
        signal: AbortSignal.timeout(context.timeoutMs),
        cache: "no-store",
      });
      if (!response.ok) {
        // Status only — response bodies can echo prompt content.
        throw new AIError(
          "PROVIDER_ERROR",
          `OpenAI request failed with status ${response.status}`,
        );
      }
      const body = (await response.json()) as {
        id?: string;
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return body;
    };

    let body: Awaited<ReturnType<typeof call>>;
    try {
      body = await call();
    } catch (error) {
      if (error instanceof AIError) throw error;
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new AIError("TIMEOUT", `OpenAI request exceeded ${context.timeoutMs}ms`);
      }
      throw new AIError("PROVIDER_ERROR", "OpenAI request failed");
    }

    const parseBody = (b: typeof body) => {
      const content = b.choices?.[0]?.message?.content;
      if (!content) return null;
      try {
        return task.schema.safeParse(JSON.parse(content));
      } catch {
        return null;
      }
    };

    let parsed = parseBody(body);
    if (!parsed || !parsed.success) {
      // One retry — malformed output is usually transient.
      try {
        body = await call();
      } catch (error) {
        if (error instanceof AIError) throw error;
        throw new AIError("PROVIDER_ERROR", "OpenAI retry failed");
      }
      parsed = parseBody(body);
    }
    if (!parsed || !parsed.success) {
      throw new AIError(
        "MALFORMED_OUTPUT",
        "OpenAI returned output that does not satisfy the task schema",
      );
    }

    const inputTokens = body.usage?.prompt_tokens ?? null;
    const outputTokens = body.usage?.completion_tokens ?? null;
    return {
      data: parsed.data,
      provider: this.name,
      model: context.model,
      usage: {
        inputTokens,
        outputTokens,
        estimatedCostCents: estimateCostCents(context.model, inputTokens, outputTokens),
        estimated: true,
      },
      providerRequestId: body.id ?? null,
    };
  }
}
