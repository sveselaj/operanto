import type {
  AIExecutionContext,
  AIProvider,
  AIProviderResult,
  AITaskDefinition,
} from "@/lib/ai/types";

/**
 * Deterministic mock provider — the DEFAULT everywhere except a production
 * tenant that an administrator explicitly switched to LIVE. Executes the
 * task's fixture logic; identical input always yields identical output, and
 * the output still passes the task schema (verified in unit tests).
 */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async executeTask<TInput, TOutput>(
    task: AITaskDefinition<TInput, TOutput>,
    input: TInput,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: AIExecutionContext,
  ): Promise<AIProviderResult<TOutput>> {
    const data = task.schema.parse(task.mock(input));
    return {
      data,
      provider: this.name,
      model: "mock",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostCents: 0,
        estimated: true,
      },
      providerRequestId: null,
    };
  }
}
