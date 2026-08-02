import type { z } from "zod";

/**
 * Provider-neutral AI contracts (Operanto Intelligence, Slice 4).
 *
 * Domain code depends on these types only — never on a vendor SDK. Every
 * provider returns schema-validated structured output or a normalized error;
 * every output is advisory until a human approves it.
 */

export type AITaskName =
  | "summarise_conversation"
  | "classify_conversation"
  | "draft_reply"
  | "recommend_next_action";

export type AITaskDefinition<TInput, TOutput> = {
  name: AITaskName;
  /** Bumped whenever the prompt or schema changes — persisted on AIAction. */
  promptVersion: string;
  /** Zod schema the provider output MUST satisfy. */
  schema: z.ZodType<TOutput>;
  system: string;
  buildPrompt: (input: TInput) => string;
  /** Deterministic mock — the default execution path in tests and staging. */
  mock: (input: TInput) => TOutput;
};

export type AIExecutionContext = {
  organisationId: string;
  /** Configured model identifier (tenant configuration, never hard-coded). */
  model: string;
  timeoutMs: number;
};

export type AIUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  /** Estimated, from the documented cost table — never treated as billing. */
  estimatedCostCents: number | null;
  estimated: true;
};

export type AIProviderResult<TOutput> = {
  data: TOutput;
  provider: string;
  model: string;
  usage: AIUsage;
  providerRequestId: string | null;
};

export interface AIProvider {
  readonly name: string;
  executeTask<TInput, TOutput>(
    task: AITaskDefinition<TInput, TOutput>,
    input: TInput,
    context: AIExecutionContext,
  ): Promise<AIProviderResult<TOutput>>;
}

/** Normalized provider failure codes — the only error surface callers see. */
export type AIErrorCode =
  | "AI_DISABLED"
  | "TASK_NOT_PERMITTED"
  | "BUDGET_EXHAUSTED"
  | "PROCESSING_RESTRICTED"
  | "TIMEOUT"
  | "MALFORMED_OUTPUT"
  | "PROVIDER_ERROR"
  | "NOT_CONFIGURED";

export class AIError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AIError";
  }
}
