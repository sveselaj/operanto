import Anthropic from "@anthropic-ai/sdk";
import {
  AIProviderError,
  type AICompletionRequest,
  type AICompletionResult,
  type AIProvider,
} from "@/lib/ai/provider";

/** Anthropic provider using forced single-tool use for structured output. */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(req: AICompletionRequest): Promise<AICompletionResult> {
    const res = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      tools: [
        {
          name: req.tool.name,
          description: req.tool.description,
          input_schema: req.tool.inputSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: req.tool.name },
    });

    const toolUse = res.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new AIProviderError("Model did not return structured tool output");
    }

    return { data: toolUse.input, model: req.model, raw: JSON.stringify(toolUse.input) };
  }
}
