import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Mock the data + config layers the service depends on.
const aIActionCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
  id: "act_1",
  ...args.data,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { aIAction: { create: (args: unknown) => aIActionCreate(args as never) } },
}));

const getProvider = vi.fn();
const modelFor = vi.fn(() => "test-classify-model");
vi.mock("@/lib/ai/config", () => ({
  getProvider: () => getProvider(),
  modelFor: () => modelFor(),
}));

// Imported after the mocks are registered.
import { runAITask } from "@/lib/ai/service";
import { AIProviderError } from "@/lib/ai/provider";
import type { AITaskDef } from "@/lib/ai/tasks";
import type { WorkspaceContext } from "@/lib/workspace";

type Out = { label: string; confidence: number };
const schema = z.object({ label: z.string(), confidence: z.number().min(0).max(1) });

const task: AITaskDef<{ text: string }, Out> = {
  name: "testTask",
  version: "v1",
  tier: "classify",
  schema,
  toolName: "record_test",
  toolDescription: "test",
  system: "system",
  buildPrompt: (i) => `classify: ${i.text}`,
  mock: () => ({ label: "mocked", confidence: 0.42 }),
};

const ctx = (role = "agent") =>
  ({ workspace: { id: "ws_1" }, member: { role }, userId: "u_1" }) as unknown as WorkspaceContext;

beforeEach(() => {
  vi.clearAllMocks();
  modelFor.mockReturnValue("test-classify-model");
});

describe("runAITask — authorization", () => {
  it("rejects a role without ai:run before calling the provider", async () => {
    await expect(runAITask(ctx("reviewer"), task, { text: "hi" })).rejects.toThrow(/ai:run/);
    expect(getProvider).not.toHaveBeenCalled();
    expect(aIActionCreate).not.toHaveBeenCalled();
  });
});

describe("runAITask — mock mode", () => {
  it("returns the task's deterministic mock and logs it as suggested", async () => {
    getProvider.mockReturnValue(null);

    const res = await runAITask(ctx(), task, { text: "hi" });

    expect(res.data).toEqual({ label: "mocked", confidence: 0.42 });
    expect(res.model).toBe("mock");
    expect(res.confidence).toBe(0.42);
    expect(aIActionCreate).toHaveBeenCalledTimes(1);
    expect(aIActionCreate.mock.calls[0][0].data).toMatchObject({
      workspaceId: "ws_1",
      userId: "u_1",
      actionType: "testTask",
      promptTemplate: "testTask@v1",
      model: "mock",
      status: "suggested",
    });
  });
});

describe("runAITask — live provider", () => {
  it("validates structured output and logs the real model", async () => {
    const complete = vi.fn(async () => ({
      data: { label: "pricing", confidence: 0.9 },
      model: "test-classify-model",
    }));
    getProvider.mockReturnValue({ name: "anthropic", complete });

    const res = await runAITask(ctx(), task, { text: "how much?" });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(res.data).toEqual({ label: "pricing", confidence: 0.9 });
    expect(res.model).toBe("test-classify-model");
    expect(aIActionCreate.mock.calls[0][0].data.status).toBe("suggested");
  });

  it("retries once on malformed output, then succeeds", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ data: { nope: true }, model: "m" })
      .mockResolvedValueOnce({ data: { label: "ok", confidence: 0.5 }, model: "m" });
    getProvider.mockReturnValue({ name: "anthropic", complete });

    const res = await runAITask(ctx(), task, { text: "x" });

    expect(complete).toHaveBeenCalledTimes(2);
    expect(res.data.label).toBe("ok");
  });

  it("throws AIProviderError and logs a failed action after two bad outputs", async () => {
    const complete = vi.fn(async () => ({ data: { bad: "shape" }, model: "m" }));
    getProvider.mockReturnValue({ name: "anthropic", complete });

    await expect(runAITask(ctx(), task, { text: "x" })).rejects.toThrow(AIProviderError);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(aIActionCreate).toHaveBeenCalledTimes(1);
    expect(aIActionCreate.mock.calls[0][0].data.status).toBe("failed");
  });

  it("logs a failed action when the provider itself throws", async () => {
    const complete = vi.fn(async () => {
      throw new Error("network down");
    });
    getProvider.mockReturnValue({ name: "anthropic", complete });

    await expect(runAITask(ctx(), task, { text: "x" })).rejects.toThrow("network down");
    expect(aIActionCreate.mock.calls[0][0].data.status).toBe("failed");
  });
});
