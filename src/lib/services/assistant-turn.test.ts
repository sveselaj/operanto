import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Exercises the streaming turn orchestration (`runAssistantTurn`) with its
 * collaborators mocked: asserts the event sequence user → tool card → streamed
 * text → done, that text deltas reconstruct the reply, and that permission is
 * enforced before anything runs.
 */
const { db, plan } = vi.hoisted(() => {
  let seq = 0;
  const msgs: Record<string, Record<string, unknown>> = {};
  return {
    plan: { result: { reply: "", toolCalls: [] as { tool: string; input: object; reason: string }[] } },
    db: {
      _msgs: msgs,
      assistantThread: {
        findFirst: vi.fn(async () => ({
          id: "th_1",
          workspaceId: "ws_1",
          title: "New chat",
          mode: "internal_assistant",
          linkedConversationId: null,
        })),
        update: vi.fn(async () => ({})),
      },
      assistantMessage: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const id = `msg_${++seq}`;
          const row = { id, createdAt: new Date(), structuredContent: null, confidence: null, content: "", ...data };
          msgs[id] = row;
          return { ...row };
        }),
        findMany: vi.fn(async () => []),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = { ...msgs[where.id], ...data };
          msgs[where.id] = row;
          return { ...row };
        }),
      },
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/verticals/registry", () => ({ getVertical: () => null }));
vi.mock("@/lib/tools/registry", () => ({
  getVisibleTools: () => [],
  toCatalog: () => [],
  getTool: () => ({ name: "x", title: "X" }),
}));
vi.mock("@/lib/tools/runtime", () => ({
  runTool: vi.fn(async () => ({
    invocation: {},
    approval: null,
    block: {
      type: "tool",
      invocationId: "inv_1",
      toolName: "x",
      title: "X",
      category: "c",
      risk: "read",
      status: "completed",
      card: "generic",
      data: {},
      summary: "did x",
    },
    title: "X",
    resultSummary: "did x",
    awaitingApproval: false,
    error: null,
  })),
}));
vi.mock("@/lib/ai/service", () => ({
  runAITask: vi.fn(async (_ctx: unknown, task: { name: string }) => {
    if (task.name === "planAssistantTurn") return { data: plan.result, confidence: 0.5, model: "mock", aiActionId: "a" };
    return { data: { reply: "Composed reply here", confidence: 0.7 }, confidence: 0.7, model: "mock", aiActionId: "b" };
  }),
}));

import { runAssistantTurn, type TurnEvent } from "@/lib/services/assistant";
import type { WorkspaceContext } from "@/lib/workspace";

const ctx = (role = "owner"): WorkspaceContext =>
  ({ workspace: { id: "ws_1", slug: "x", vertical: "generic" }, member: { role }, userId: "u_1" }) as unknown as WorkspaceContext;

async function collect(gen: AsyncGenerator<TurnEvent>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

beforeEach(() => {
  vi.clearAllMocks();
  plan.result = { reply: "", toolCalls: [] };
});

describe("runAssistantTurn — event stream", () => {
  it("emits user → tool card → streamed text → done, grounded in tool results", async () => {
    plan.result = { reply: "ack", toolCalls: [{ tool: "x", input: {}, reason: "r" }] };
    const events = await collect(runAssistantTurn(ctx(), "th_1", "do x"));

    expect(events[0].type).toBe("user");
    expect((events[0] as Extract<TurnEvent, { type: "user" }>).message.content).toBe("do x");

    const blocks = events.filter((e) => e.type === "block");
    expect(blocks).toHaveLength(1);

    const text = events
      .filter((e): e is Extract<TurnEvent, { type: "text" }> => e.type === "text")
      .map((e) => e.delta)
      .join("");
    expect(text).toBe("Composed reply here"); // composed AFTER tools ran

    const done = events.at(-1) as Extract<TurnEvent, { type: "done" }>;
    expect(done.type).toBe("done");
    expect(done.message.content).toBe("Composed reply here");
    expect(done.message.structuredContent?.blocks).toHaveLength(1);
  });

  it("uses the plan's direct reply when no tools are needed (no compose, no blocks)", async () => {
    plan.result = { reply: "Direct answer.", toolCalls: [] };
    const events = await collect(runAssistantTurn(ctx(), "th_1", "hi"));

    expect(events.some((e) => e.type === "block")).toBe(false);
    const text = events
      .filter((e): e is Extract<TurnEvent, { type: "text" }> => e.type === "text")
      .map((e) => e.delta)
      .join("");
    expect(text).toBe("Direct answer.");
    const done = events.at(-1) as Extract<TurnEvent, { type: "done" }>;
    expect(done.message.content).toBe("Direct answer.");
  });

  it("enforces assistant:use before doing anything", async () => {
    const gen = runAssistantTurn(ctx("client_viewer"), "th_1", "hi");
    await expect(gen.next()).rejects.toThrow();
    expect(db.assistantMessage.create).not.toHaveBeenCalled();
  });
});
