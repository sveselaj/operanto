import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "@/lib/ai/openai-provider";
import { AIError } from "@/lib/ai/types";
import { AI_TASKS, type ConversationAIInput } from "@/lib/ai/tasks";

/**
 * Error normalization of the OpenAI adapter, with fetch stubbed — no network,
 * no key, no content ever logged. The adapter's happy path is exercised by
 * the same Zod schemas the mock provider proves.
 */

const task = AI_TASKS.CLASSIFICATION;
const input: ConversationAIInput = {
  channelLabel: "Manual",
  subject: null,
  status: "OPEN",
  priority: "NORMAL",
  customerName: null,
  restrictedCustomer: false,
  messages: [{ direction: "INBOUND", body: "Where is my order?" }],
  internalNotes: [],
  openTaskTitles: [],
  opportunitySummaries: [],
  knownChannelIdentity: null,
  language: null,
};
const context = { organisationId: "org_1", model: "gpt-4o-mini", timeoutMs: 50 };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OpenAI adapter error normalization", () => {
  it("refuses without a key as NOT_CONFIGURED", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(
      new OpenAIProvider().executeTask(task, input, context),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("normalizes HTTP failures to PROVIDER_ERROR without echoing content", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream detail", { status: 500 })),
    );
    const error = await new OpenAIProvider()
      .executeTask(task, input, context)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIError);
    expect((error as AIError).code).toBe("PROVIDER_ERROR");
    expect((error as AIError).message).not.toContain("upstream detail");
    expect((error as AIError).message).not.toContain("Where is my order");
  });

  it("retries malformed output once, then fails as MALFORMED_OUTPUT", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn(async () =>
      Response.json({
        id: "req_1",
        choices: [{ message: { content: '{"not":"the schema"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new OpenAIProvider().executeTask(task, input, context),
    ).rejects.toMatchObject({ code: "MALFORMED_OUTPUT" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns validated output with usage and request id", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const valid = task.mock(input);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id: "req_ok",
          choices: [{ message: { content: JSON.stringify(valid) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
      ),
    );
    const result = await new OpenAIProvider().executeTask(task, input, context);
    expect(result.data.primaryIntent).toBe(valid.primaryIntent);
    expect(result.providerRequestId).toBe("req_ok");
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.estimated).toBe(true);
  });
});
