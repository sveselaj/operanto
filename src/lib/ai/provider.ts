/**
 * Provider-agnostic AI interface.
 *
 * Every AI task produces *structured* output: the provider is asked to call a
 * single tool whose input schema is the task's JSON schema, and we return that
 * tool input as `data`. This keeps outputs parseable and lets us swap providers
 * (Anthropic, OpenAI, local) without touching task logic.
 */
export type AICompletionRequest = {
  model: string;
  system: string;
  prompt: string;
  tool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  maxTokens?: number;
};

export type AICompletionResult = {
  /** Raw parsed JSON returned as the tool input (validated by the caller). */
  data: unknown;
  /** Model actually used (for logging). */
  model: string;
  /** Optional raw text, for debugging/audit. */
  raw?: string;
};

export interface AIProvider {
  readonly name: string;
  complete(req: AICompletionRequest): Promise<AICompletionResult>;
}

export class AIProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIProviderError";
  }
}
