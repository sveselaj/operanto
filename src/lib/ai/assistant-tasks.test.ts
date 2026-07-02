import { describe, it, expect } from "vitest";
import {
  planAssistantTurnTask,
  composeAssistantReplyTask,
  translateTask,
  type PlanTurnInput,
} from "@/lib/ai/assistant-tasks";
import type { ToolCatalogEntry } from "@/lib/tools/types";

const CATALOG: ToolCatalogEntry[] = [
  { name: "search_contacts", title: "", description: "", category: "contacts", risk: "read", inputSchema: {} },
  { name: "search_conversations", title: "", description: "", category: "conversations", risk: "read", inputSchema: {} },
  { name: "search_properties", title: "", description: "", category: "properties", risk: "read", inputSchema: {} },
  { name: "get_property", title: "", description: "", category: "properties", risk: "read", inputSchema: {} },
  { name: "check_property_availability", title: "", description: "", category: "properties", risk: "read", inputSchema: {} },
  { name: "draft_social_post", title: "", description: "", category: "social", risk: "draft", inputSchema: {} },
];

const plan = (userMessage: string): PlanTurnInput => ({ userMessage, history: [], tools: CATALOG });

describe("planAssistantTurn mock (offline planner)", () => {
  it("maps a German-buyer query to search_contacts with a location filter", () => {
    const out = planAssistantTurnTask.mock(plan("Show buyers from Germany looking for apartments"));
    const call = out.toolCalls.find((c) => c.tool === "search_contacts");
    expect(call).toBeTruthy();
    expect(call!.input).toMatchObject({ location: "Germany" });
  });

  it("maps 'not contacted in 7 days' to search_conversations", () => {
    const out = planAssistantTurnTask.mock(plan("Find leads not contacted in 7 days"));
    const call = out.toolCalls.find((c) => c.tool === "search_conversations");
    expect(call?.input).toMatchObject({ notContactedForDays: 7 });
  });

  it("routes an availability question with a property code to check_property_availability", () => {
    const out = planAssistantTurnTask.mock(plan("Is PR-1042 still available?"));
    const call = out.toolCalls.find((c) => c.tool === "check_property_availability");
    expect(call?.input).toMatchObject({ code: "PR-1042" });
  });

  it("maps a social request to draft_social_post (a draft-only tool)", () => {
    const out = planAssistantTurnTask.mock(plan("Draft an Instagram post for PR-1042"));
    expect(out.toolCalls.some((c) => c.tool === "draft_social_post")).toBe(true);
  });

  it("never proposes a tool that isn't in the catalog", () => {
    const out = planAssistantTurnTask.mock({
      userMessage: "Is PR-1042 available?",
      history: [],
      tools: [], // empty catalog
    });
    expect(out.toolCalls).toHaveLength(0);
  });

  it("returns a plain reply and no tools for small talk", () => {
    const out = planAssistantTurnTask.mock(plan("hello there"));
    expect(out.toolCalls).toHaveLength(0);
    expect(out.reply.length).toBeGreaterThan(0);
  });
});

describe("planAssistantTurn mock — conversation context (customer_conversation)", () => {
  const CONV_CATALOG: ToolCatalogEntry[] = [
    ...CATALOG,
    { name: "draft_customer_reply", title: "", description: "", category: "messaging", risk: "draft", inputSchema: {} },
    { name: "summarize_conversation", title: "", description: "", category: "conversations", risk: "read", inputSchema: {} },
    { name: "find_matching_properties", title: "", description: "", category: "properties", risk: "read", inputSchema: {} },
  ];
  const withCtx = (userMessage: string, context: PlanTurnInput["context"]): PlanTurnInput => ({
    userMessage,
    history: [],
    tools: CONV_CATALOG,
    context,
  });

  it("auto-targets the active conversation for a reply draft", () => {
    const out = planAssistantTurnTask.mock(
      withCtx("Draft a reply", { conversationId: "conv_1" }),
    );
    const call = out.toolCalls.find((c) => c.tool === "draft_customer_reply");
    expect(call?.input).toMatchObject({ conversationId: "conv_1" });
  });

  it("auto-targets the active conversation for summarize", () => {
    const out = planAssistantTurnTask.mock(
      withCtx("summarize this conversation", { conversationId: "conv_1" }),
    );
    const call = out.toolCalls.find((c) => c.tool === "summarize_conversation");
    expect(call?.input).toMatchObject({ conversationId: "conv_1" });
  });

  it("falls back to the context property code for availability when none is typed", () => {
    const out = planAssistantTurnTask.mock(
      withCtx("is it still available?", { conversationId: "conv_1", propertyCode: "PR-1042" }),
    );
    const call = out.toolCalls.find((c) => c.tool === "check_property_availability");
    expect(call?.input).toMatchObject({ code: "PR-1042" });
  });
});

describe("composeAssistantReply mock (grounding)", () => {
  it("marks awaiting-approval results as prepared, not done", () => {
    const out = composeAssistantReplyTask.mock({
      userMessage: "publish the post",
      toolResults: [
        { tool: "queue_social_post", title: "Publish post", ok: true, summary: "queued", awaitingApproval: true },
      ],
    });
    expect(out.reply).toMatch(/awaiting your approval/i);
    expect(out.reply).not.toMatch(/published successfully/i);
  });

  it("reports failures explicitly and confirms nothing changed", () => {
    const out = composeAssistantReplyTask.mock({
      userMessage: "send it",
      toolResults: [
        { tool: "send_customer_message", title: "Send message", ok: false, summary: "", error: "Channel not connected" },
      ],
    });
    expect(out.reply).toMatch(/couldn't complete/i);
    expect(out.reply).toMatch(/nothing was changed/i);
  });
});

describe("translate mock", () => {
  it("is honest about being offline (low confidence, pass-through)", () => {
    const out = translateTask.mock({ text: "Përshëndetje", targetLanguage: "English" });
    expect(out.confidence).toBeLessThan(0.5);
    expect(out.translated).toContain("Përshëndetje");
  });
});
