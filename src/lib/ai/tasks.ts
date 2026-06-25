import { z } from "zod";
import { Intent, Sentiment } from "@prisma/client";
import type { ModelTier } from "@/lib/ai/config";

import { InsightType, Priority } from "@prisma/client";

const intentValues = Object.values(Intent) as [string, ...string[]];
const sentimentValues = Object.values(Sentiment) as [string, ...string[]];
const insightTypeValues = Object.values(InsightType) as [string, ...string[]];
const priorityValues = Object.values(Priority) as [string, ...string[]];

// ── Shared input shape ────────────────────────────────────────
export type BrandVoiceContext = {
  tone?: string | null;
  dos?: string[];
  donts?: string[];
  examplePhrases?: string[];
};

export type ConversationAIInput = {
  channel: string;
  subject?: string | null;
  customerName?: string | null;
  brandVoice?: BrandVoiceContext | null;
  messages: { role: "customer" | "agent"; body: string }[];
  /** Optional steering note for reply drafting. */
  instruction?: string;
};

// ── Task definition ───────────────────────────────────────────
export type AITaskDef<TInput, TOutput> = {
  name: string;
  version: string;
  tier: ModelTier;
  schema: z.ZodType<TOutput>;
  toolName: string;
  toolDescription: string;
  system: string;
  buildPrompt: (input: TInput) => string;
  /** Deterministic offline output used in mock mode. */
  mock: (input: TInput) => TOutput;
};

// ── Helpers ───────────────────────────────────────────────────
function transcript(input: ConversationAIInput): string {
  const who = (r: "customer" | "agent") =>
    r === "customer" ? (input.customerName ?? "Customer") : "Agent";
  const lines = input.messages.map((m) => `${who(m.role)}: ${m.body}`).join("\n");
  return lines || "(no messages yet)";
}

function brandVoiceBlock(bv?: BrandVoiceContext | null): string {
  if (!bv) return "No brand voice configured; use a warm, professional, concise tone.";
  const parts = [`Tone: ${bv.tone ?? "warm, professional"}`];
  if (bv.dos?.length) parts.push(`Do: ${bv.dos.join("; ")}`);
  if (bv.donts?.length) parts.push(`Don't: ${bv.donts.join("; ")}`);
  if (bv.examplePhrases?.length) parts.push(`Example phrases: ${bv.examplePhrases.join(" | ")}`);
  return parts.join("\n");
}

const GUARDRAILS =
  "Guardrails: Do not invent prices, policies, availability, or facts not present in the conversation. " +
  "If key information is missing, say so and ask for it. Never promise outcomes you cannot guarantee.";

const lastCustomerMessage = (input: ConversationAIInput) =>
  [...input.messages].reverse().find((m) => m.role === "customer")?.body ?? "";

// ── Mock heuristics ───────────────────────────────────────────
function mockIntent(text: string): string {
  const t = text.toLowerCase();
  if (/(price|cost|how much|pricing|€|\$)/.test(t)) return "pricing_inquiry";
  if (/(book|appointment|availab|slot|schedule)/.test(t)) return "appointment_request";
  if (/(refund|money back)/.test(t)) return "refund_request";
  if (/(late|complain|angry|unhappy|disappointed|terrible)/.test(t)) return "complaint";
  if (/(deliver|shipping|ship|arrive)/.test(t)) return "delivery_question";
  if (/(custom|make|order)/.test(t)) return "product_inquiry";
  return "service_inquiry";
}
function mockSentiment(text: string): string {
  const t = text.toLowerCase();
  if (/(angry|terrible|worst|furious)/.test(t)) return "angry";
  if (/(late|not happy|disappointed|frustrat|complain)/.test(t)) return "frustrated";
  if (/(thanks|great|love|😊|🙏|please)/.test(t)) return "positive";
  return "neutral";
}
function mockLeadScore(text: string, intent: string): number {
  let score = 40;
  if (intent === "pricing_inquiry" || intent === "appointment_request") score += 30;
  if (intent === "product_inquiry") score += 25;
  if (/(book|buy|today|this week|asap|need)/.test(text.toLowerCase())) score += 15;
  if (intent === "complaint" || intent === "refund_request") score -= 20;
  return Math.max(0, Math.min(100, score));
}

// ── summarizeConversation ─────────────────────────────────────
const summarizeSchema = z.object({
  summary: z.string().describe("One or two sentence summary of the conversation"),
  currentState: z.string().describe("Where the conversation currently stands"),
  unresolvedQuestion: z.string().nullable().describe("Open question from the customer, or null"),
  recommendedNextAction: z.string().describe("The single best next action for the agent"),
  confidence: z.number().min(0).max(1),
});
export type SummarizeOutput = z.infer<typeof summarizeSchema>;

export const summarizeTask: AITaskDef<ConversationAIInput, SummarizeOutput> = {
  name: "summarizeConversation",
  version: "v1",
  tier: "classify",
  schema: summarizeSchema,
  toolName: "record_summary",
  toolDescription: "Record a structured summary of the customer conversation.",
  system: `You summarize customer support/sales conversations for a business operations platform. Be concise and actionable. ${GUARDRAILS}`,
  buildPrompt: (input) =>
    `Channel: ${input.channel}\nSubject: ${input.subject ?? "(none)"}\n\nConversation:\n${transcript(input)}\n\nSummarize it and recommend the next action.`,
  mock: (input) => {
    const last = lastCustomerMessage(input);
    return {
      summary: last
        ? `Customer asked: "${last.slice(0, 120)}"`
        : "No customer messages yet.",
      currentState: "Awaiting an agent response.",
      unresolvedQuestion: last || null,
      recommendedNextAction: "Reply addressing the customer's question and confirm next steps.",
      confidence: 0.6,
    };
  },
};

// ── classifyConversation ──────────────────────────────────────
const classifySchema = z.object({
  intent: z.enum(intentValues),
  sentiment: z.enum(sentimentValues),
  leadScore: z.number().int().min(0).max(100),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ClassifyOutput = z.infer<typeof classifySchema>;

export const classifyTask: AITaskDef<ConversationAIInput, ClassifyOutput> = {
  name: "classifyConversation",
  version: "v1",
  tier: "classify",
  schema: classifySchema,
  toolName: "record_classification",
  toolDescription: "Classify the conversation's intent, sentiment and lead quality.",
  system: `You classify customer conversations. Choose the single best intent and sentiment from the allowed values. Lead score 0-100 reflects buying intent, urgency and clarity. ${GUARDRAILS}`,
  buildPrompt: (input) =>
    `Channel: ${input.channel}\n\nConversation:\n${transcript(input)}\n\nClassify intent, sentiment, and lead score.`,
  mock: (input) => {
    const last = lastCustomerMessage(input);
    const intent = mockIntent(last);
    return {
      intent,
      sentiment: mockSentiment(last),
      leadScore: mockLeadScore(last, intent),
      reasoning: "Heuristic classification (mock mode).",
      confidence: 0.6,
    };
  },
};

// ── draftReply ────────────────────────────────────────────────
const draftReplySchema = z.object({
  reply: z.string().describe("The suggested reply text, ready for an agent to edit and send"),
  reasoning: z.string().describe("Why this reply, briefly"),
  risk: z.enum(["low", "medium", "high"]).describe("Risk that this reply is inappropriate"),
  recommendedFollowUp: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type DraftReplyOutput = z.infer<typeof draftReplySchema>;

export const draftReplyTask: AITaskDef<ConversationAIInput, DraftReplyOutput> = {
  name: "draftReply",
  version: "v1",
  tier: "generation",
  schema: draftReplySchema,
  toolName: "record_draft_reply",
  toolDescription: "Draft a reply to the customer in the business's brand voice.",
  system: `You draft replies to customers on behalf of a business. Match the brand voice. The reply will be reviewed and edited by a human before sending — never send it yourself. ${GUARDRAILS}`,
  buildPrompt: (input) =>
    `Channel: ${input.channel}\nBrand voice:\n${brandVoiceBlock(input.brandVoice)}\n\nConversation:\n${transcript(input)}\n${
      input.instruction ? `\nAgent guidance: ${input.instruction}\n` : ""
    }\nDraft the best next reply to the customer.`,
  mock: (input) => {
    const name = input.customerName?.split(" ")[0] ?? "there";
    const last = lastCustomerMessage(input);
    const intent = mockIntent(last);
    const body =
      intent === "pricing_inquiry"
        ? `Hi ${name}! Thanks for reaching out 😊 I'd love to help with pricing. Could you let me know exactly which service you're interested in so I can share the right details and get you booked in?`
        : intent === "complaint"
          ? `Hi ${name}, I'm really sorry about this — that's not the experience we want for you. Thank you for telling us. I'd like to make it right; could you share a little more so I can sort it out today?`
          : `Hi ${name}! Thanks so much for your message. I'd be happy to help — could you share a couple more details so I can give you exactly what you need?`;
    return {
      reply: body,
      reasoning: "Brand-voice reply tailored to the detected intent (mock mode).",
      risk: intent === "complaint" ? "medium" : "low",
      recommendedFollowUp: "Follow up tomorrow if no reply.",
      confidence: 0.6,
    };
  },
};

// ── generateSOP ───────────────────────────────────────────────
export type GenerateSOPInput = {
  topic: string;
  businessType?: string | null;
  desiredOutcome?: string | null;
  examples?: string | null;
};

const generateSOPSchema = z.object({
  title: z.string(),
  description: z.string(),
  category: z.string(),
  purpose: z.string(),
  whenToUse: z.string(),
  steps: z.array(z.string()).min(1),
  escalationRules: z.string().nullable(),
  examples: z.array(z.string()),
  qualityChecklist: z.array(z.string()),
  commonMistakes: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type GenerateSOPOutput = z.infer<typeof generateSOPSchema>;

export const generateSOPTask: AITaskDef<GenerateSOPInput, GenerateSOPOutput> = {
  name: "generateSOP",
  version: "v1",
  tier: "generation",
  schema: generateSOPSchema,
  toolName: "record_sop",
  toolDescription: "Produce a structured standard operating procedure.",
  system: `You write clear, practical SOPs for small-business operations teams. Steps must be concrete and ordered. ${GUARDRAILS}`,
  buildPrompt: (input) =>
    `Topic: ${input.topic}\nBusiness type: ${input.businessType ?? "general SMB"}\nDesired outcome: ${input.desiredOutcome ?? "consistent, high-quality execution"}\n${
      input.examples ? `Examples/context: ${input.examples}\n` : ""
    }\nWrite a complete SOP.`,
  mock: (input) => ({
    title: input.topic.replace(/^\w/, (c) => c.toUpperCase()),
    description: `Standard procedure for: ${input.topic}.`,
    category: "Operations",
    purpose: `Ensure ${input.desiredOutcome ?? "consistent handling"} for "${input.topic}".`,
    whenToUse: `Use whenever a situation involving "${input.topic}" arises.`,
    steps: [
      "Acknowledge the request promptly and gather the relevant details.",
      "Follow the approved process and reference any policies that apply.",
      "Take the appropriate action and confirm it with the customer or team.",
      "Log the outcome and create a follow-up task if needed.",
    ],
    escalationRules: "Escalate to a manager if the case is unresolved within the SLA or involves a refund/complaint.",
    examples: [`A typical "${input.topic}" case and how to handle it end to end.`],
    qualityChecklist: ["Responded within SLA", "Followed the steps", "Logged the outcome"],
    commonMistakes: ["Skipping acknowledgement", "Promising something not in policy"],
    confidence: 0.6,
  }),
};

// ── generateContent ───────────────────────────────────────────
export type GenerateContentInput = {
  channel: string;
  goal: string;
  sourceText?: string | null;
  brandVoice?: BrandVoiceContext | null;
};

const generateContentSchema = z.object({
  title: z.string().describe("Short internal title for this content"),
  hook: z.string().describe("Attention-grabbing opening line"),
  caption: z.string().describe("The main body/caption"),
  cta: z.string().describe("Call to action"),
  hashtags: z.array(z.string()).describe("Relevant hashtags without the # symbol"),
  visualDirection: z.string().describe("Suggested visual/photo direction"),
  variants: z.array(z.string()).describe("1-2 alternative caption versions"),
  confidence: z.number().min(0).max(1),
});
export type GenerateContentOutput = z.infer<typeof generateContentSchema>;

export const generateContentTask: AITaskDef<GenerateContentInput, GenerateContentOutput> = {
  name: "generateContent",
  version: "v1",
  tier: "generation",
  schema: generateContentSchema,
  toolName: "record_content",
  toolDescription: "Produce a social/marketing content draft in the brand voice.",
  system: `You are a content creator for a small business. Write in the brand voice, for the target channel. Content should be grounded in the provided context (real customer questions, services). ${GUARDRAILS}`,
  buildPrompt: (input) =>
    `Channel: ${input.channel}\nGoal: ${input.goal}\nBrand voice:\n${brandVoiceBlock(input.brandVoice)}\n${
      input.sourceText ? `\nSource context (e.g. customer conversation/insight):\n${input.sourceText}\n` : ""
    }\nCreate the content draft.`,
  mock: (input) => {
    const hashtags =
      input.channel === "instagram" || input.channel === "tiktok"
        ? ["smallbusiness", "behindthescenes", "local"]
        : [];
    return {
      title: input.goal.slice(0, 60),
      hook: "Ever wondered about this? Let's clear it up 👇",
      caption: `${input.goal}. We get this question a lot, so here's the honest answer — and how we can help. ${
        input.sourceText ? "Inspired by a real conversation with one of you." : ""
      }`.trim(),
      cta: "DM us to get started ✨",
      hashtags,
      visualDirection: "A clean, bright photo of the product/service with friendly on-brand styling.",
      variants: [
        "Short version: Here's the quick answer to your most-asked question 👇",
        "Story version: A customer asked us this recently — here's what we told them.",
      ],
      confidence: 0.6,
    };
  },
};

// ── managerInsights ───────────────────────────────────────────
export type ManagerInsightsInput = {
  stats: string; // pre-formatted summary of workspace metrics
};

const managerInsightsSchema = z.object({
  insights: z
    .array(
      z.object({
        type: z.enum(insightTypeValues),
        title: z.string(),
        description: z.string(),
        priority: z.enum(priorityValues),
      }),
    )
    .max(6),
  confidence: z.number().min(0).max(1),
});
export type ManagerInsightsOutput = z.infer<typeof managerInsightsSchema>;

export const managerInsightsTask: AITaskDef<ManagerInsightsInput, ManagerInsightsOutput> = {
  name: "managerInsights",
  version: "v1",
  tier: "generation",
  schema: managerInsightsSchema,
  toolName: "record_insights",
  toolDescription: "Record actionable manager insights derived from workspace metrics.",
  system: `You are an operations analyst for a small business. Given workspace metrics, surface the few most actionable insights: late replies, unanswered leads, recurring questions, content opportunities, performance issues. Be specific and base every insight on the numbers provided. ${GUARDRAILS}`,
  buildPrompt: (input) =>
    `Workspace metrics:\n${input.stats}\n\nProduce up to 6 prioritized, actionable insights.`,
  mock: (input) => {
    void input;
    return {
      insights: [
        {
          type: "performance_issue",
          title: "Some leads are waiting too long for a reply",
          description: "Open conversations with high lead scores have not received a response. Prioritize them today.",
          priority: "high",
        },
        {
          type: "content_opportunity",
          title: "Turn your most common question into a post",
          description: "Your most frequent intent suggests a reusable FAQ/post would deflect repeat questions.",
          priority: "normal",
        },
      ],
      confidence: 0.6,
    };
  },
};

// ── extractRequirements (Lead Engine) ─────────────────────────
const requirementValueTypes = ["number", "text", "enum", "date", "bool"] as const;

const requirementItemSchema = z.object({
  key: z.string().describe("stable snake_case key, e.g. window_count"),
  label: z.string().describe("human-friendly label, e.g. Number of windows"),
  valueType: z.enum(requirementValueTypes),
  value: z.string().nullable().describe("the value if the customer stated it, else null"),
  required: z.boolean().describe("whether this fact is essential to qualify/quote"),
  confidence: z.number().min(0).max(1),
});
const extractRequirementsSchema = z.object({
  requirements: z.array(requirementItemSchema).max(20),
  confidence: z.number().min(0).max(1),
});
export type RequirementItem = z.infer<typeof requirementItemSchema>;
export type ExtractRequirementsOutput = z.infer<typeof extractRequirementsSchema>;

export const extractRequirementsTask: AITaskDef<ConversationAIInput, ExtractRequirementsOutput> = {
  name: "extractRequirements",
  version: "v1",
  tier: "generation",
  schema: extractRequirementsSchema,
  toolName: "record_requirements",
  toolDescription: "Record the structured facts needed to qualify and quote this lead.",
  system: `You qualify sales leads for a business. From the conversation, extract the structured facts a salesperson needs to prepare a quote (quantities, dimensions/specs, materials/options, location, timeframe, budget). Use stable snake_case keys. Mark a fact 'required' when it is essential to quote. Set value to null when the customer hasn't stated it yet — list it anyway so the gap is visible. ${GUARDRAILS}`,
  buildPrompt: (input) =>
    `Channel: ${input.channel}\nCustomer: ${input.customerName ?? "(unknown)"}\n\nConversation:\n${transcript(input)}\n\nExtract the qualification requirements (provided and still-missing).`,
  mock: (input) => {
    const text = input.messages.map((m) => m.body).join(" ").toLowerCase();
    const count = text.match(/(\d+)\s*(window|windows|door|doors|panel|unit|piece|room)/);
    const material = text.match(/(pvc|aluminium|aluminum|wood|timber|glass)/);
    return {
      requirements: [
        { key: "item_count", label: "Quantity needed", valueType: "number" as const, value: count ? count[1] : null, required: true, confidence: 0.6 },
        { key: "material", label: "Preferred material", valueType: "text" as const, value: material ? material[0] : null, required: true, confidence: 0.55 },
        { key: "location", label: "Property location", valueType: "text" as const, value: null, required: true, confidence: 0.5 },
        { key: "timeframe", label: "Desired timeframe", valueType: "text" as const, value: /(week|month|asap|urgent|soon)/.test(text) ? "soon" : null, required: false, confidence: 0.5 },
      ],
      confidence: 0.6,
    };
  },
};

// ── requestInfo (draft a message asking for missing facts) ────
export type RequestInfoInput = {
  channel: string;
  customerName?: string | null;
  brandVoice?: BrandVoiceContext | null;
  missingLabels: string[];
};
const requestInfoSchema = z.object({
  message: z.string().describe("a short, friendly message asking for the missing details, in brand voice"),
  confidence: z.number().min(0).max(1),
});
export type RequestInfoOutput = z.infer<typeof requestInfoSchema>;

export const requestInfoTask: AITaskDef<RequestInfoInput, RequestInfoOutput> = {
  name: "requestInfo",
  version: "v1",
  tier: "generation",
  schema: requestInfoSchema,
  toolName: "record_info_request",
  toolDescription: "Draft a message asking the customer for the missing qualification details.",
  system: `You draft a short, warm message asking a customer for the specific details still needed to prepare their quote. Match the brand voice. Ask only for the listed missing items, grouped naturally. A human reviews before sending. ${GUARDRAILS}`,
  buildPrompt: (input) =>
    `Channel: ${input.channel}\nCustomer: ${input.customerName ?? "(unknown)"}\nBrand voice:\n${brandVoiceBlock(input.brandVoice)}\n\nStill missing: ${input.missingLabels.join(", ")}\n\nDraft a message asking for these details.`,
  mock: (input) => {
    const name = input.customerName?.split(" ")[0] ?? "there";
    return {
      message: `Hi ${name}! To put together an accurate quote, could you share: ${input.missingLabels.join(", ")}? Thanks so much 🙏`,
      confidence: 0.6,
    };
  },
};

export const AI_TASKS = {
  summarizeConversation: summarizeTask,
  classifyConversation: classifyTask,
  draftReply: draftReplyTask,
  generateSOP: generateSOPTask,
  generateContent: generateContentTask,
  managerInsights: managerInsightsTask,
  extractRequirements: extractRequirementsTask,
  requestInfo: requestInfoTask,
} as const;
