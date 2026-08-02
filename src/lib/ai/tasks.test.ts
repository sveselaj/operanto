import { describe, expect, it } from "vitest";
import { AI_TASKS, type ConversationAIInput } from "@/lib/ai/tasks";

/**
 * Mock determinism and fixture behaviour. The mock provider is the default
 * execution path everywhere below production, so these fixtures ARE the
 * product behaviour that tests and staging see.
 */

function input(body: string, customerName: string | null = null): ConversationAIInput {
  return {
    channelLabel: "Simulator",
    subject: null,
    status: "OPEN",
    priority: "NORMAL",
    customerName,
    restrictedCustomer: false,
    messages: [{ direction: "INBOUND", body }],
    internalNotes: [],
    openTaskTitles: [],
    opportunitySummaries: [],
    knownChannelIdentity: null,
    language: null,
  };
}

const NAGELISTA =
  "Hello, I ordered a nail set last week. Can you tell me whether it has been shipped?";
const PRONATONA =
  "I am looking for a two-bedroom apartment in Prishtina with a budget up to €150,000.";

describe("mock determinism", () => {
  it("identical input yields byte-identical output for every task", () => {
    for (const task of Object.values(AI_TASKS)) {
      const a = task.mock(input(NAGELISTA) as never);
      const b = task.mock(input(NAGELISTA) as never);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it("every mock output satisfies its own schema", () => {
    for (const task of Object.values(AI_TASKS)) {
      for (const fixture of [NAGELISTA, PRONATONA]) {
        expect(() => task.schema.parse(task.mock(input(fixture) as never))).not.toThrow();
      }
    }
  });
});

describe("Nagelista fixture", () => {
  it("classifies as an order-status enquiry with moderate urgency", () => {
    const out = AI_TASKS.CLASSIFICATION.mock(input(NAGELISTA));
    expect(out.primaryIntent).toBe("ORDER_STATUS");
    expect(out.urgency).toBe("MEDIUM");
    expect(out.requiresHumanAttention).toBe(true);
  });

  it("drafts a reply that never invents shipment status", () => {
    const out = AI_TASKS.REPLY_DRAFT.mock(input(NAGELISTA, "Blerta"));
    expect(out.reply).not.toMatch(/has been shipped|was shipped|is on its way|delivered/i);
    expect(out.reply).toMatch(/order number/i);
    expect(out.missingInformation).toContain("Shipment status from fulfilment");
    expect(out.requiresApproval).toBe(true);
    expect(out.reply).toContain("Blerta");
  });

  it("recommends a delivery follow-up task", () => {
    const out = AI_TASKS.NEXT_ACTION.mock(input(NAGELISTA));
    expect(out.action).toBe("CREATE_FOLLOW_UP_TASK");
    expect(out.suggestedTaskTitle).toMatch(/shipment/i);
  });
});

describe("Pronatona fixture", () => {
  it("classifies as a property search and extracts the requirement", () => {
    const out = AI_TASKS.CLASSIFICATION.mock(input(PRONATONA));
    expect(out.primaryIntent).toBe("PROPERTY_SEARCH");
    expect(out.rationale).toMatch(/location, bedroom count and budget/i);
  });

  it("drafts a personalised, non-committal reply without invented availability", () => {
    const out = AI_TASKS.REPLY_DRAFT.mock(input(PRONATONA, "Ardit"));
    expect(out.reply).toContain("Ardit");
    expect(out.reply).toMatch(/€150,000/);
    expect(out.reply).not.toMatch(/we have (an|the) apartment|available now|found a match/i);
    expect(out.requiresApproval).toBe(true);
  });

  it("summarises with the budget and recommends a follow-up task", () => {
    const summary = AI_TASKS.SUMMARY.mock(input(PRONATONA));
    expect(summary.summary).toMatch(/two-bedroom/i);
    expect(summary.summary).toMatch(/€150,000/);
    expect(summary.recommendedNextAction).toBe("CREATE_FOLLOW_UP_TASK");
    const next = AI_TASKS.NEXT_ACTION.mock(input(PRONATONA));
    expect(next.suggestedTaskTitle).toMatch(/Prishtina/);
  });
});
