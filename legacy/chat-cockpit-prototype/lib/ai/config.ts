import type { AIProvider } from "@/lib/ai/provider";
import { AnthropicProvider } from "@/lib/ai/anthropic";

export type ModelTier = "classify" | "generation";

/**
 * Mock mode runs tasks with their built-in deterministic outputs and makes no
 * external calls. Active when no API key is configured or AI_PROVIDER=mock, so
 * the whole app is usable in development without credentials.
 */
export function isMockMode(): boolean {
  return process.env.AI_PROVIDER === "mock" || !process.env.ANTHROPIC_API_KEY;
}

export function modelFor(tier: ModelTier): string {
  if (tier === "generation")
    return process.env.AI_MODEL_GENERATION ?? "claude-opus-4-7";
  return process.env.AI_MODEL_CLASSIFY ?? "claude-haiku-4-5-20251001";
}

let cached: AIProvider | null = null;

/** Returns the configured provider, or null in mock mode. */
export function getProvider(): AIProvider | null {
  if (isMockMode()) return null;
  if (cached) return cached;

  const provider = process.env.AI_PROVIDER ?? "anthropic";
  if (provider === "anthropic") {
    cached = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!);
    return cached;
  }
  // Future: openai, local. Fall back to mock for unknown providers.
  return null;
}
