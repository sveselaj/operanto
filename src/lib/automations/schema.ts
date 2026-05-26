import { z } from "zod";
import { Intent, Sentiment, ChannelType, Priority } from "@prisma/client";

const intentValues = Object.values(Intent) as [string, ...string[]];
const sentimentValues = Object.values(Sentiment) as [string, ...string[]];
const channelValues = Object.values(ChannelType) as [string, ...string[]];
const priorityValues = Object.values(Priority) as [string, ...string[]];

/** A single condition; all conditions on an automation are AND-ed together. */
export const conditionSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("intent"), value: z.enum(intentValues) }),
  z.object({ field: z.literal("sentiment"), value: z.enum(sentimentValues) }),
  z.object({ field: z.literal("channelType"), value: z.enum(channelValues) }),
  z.object({ field: z.literal("leadScoreGte"), value: z.number().int().min(0).max(100) }),
  z.object({ field: z.literal("messageContains"), value: z.string().min(1) }),
]);
export type Condition = z.infer<typeof conditionSchema>;

/** Actions executed when conditions match. */
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_tag"), tagId: z.string() }),
  z.object({ type: z.literal("set_priority"), priority: z.enum(priorityValues) }),
  z.object({ type: z.literal("assign"), userId: z.string() }),
  z.object({ type: z.literal("create_task"), title: z.string().min(1) }),
]);
export type Action = z.infer<typeof actionSchema>;

export const automationConfigSchema = z.object({
  conditions: z.array(conditionSchema),
  actions: z.array(actionSchema).min(1, "Add at least one action"),
});
export type AutomationConfig = z.infer<typeof automationConfigSchema>;

export const CONDITION_FIELDS = [
  { value: "intent", label: "Intent is" },
  { value: "sentiment", label: "Sentiment is" },
  { value: "channelType", label: "Channel is" },
  { value: "leadScoreGte", label: "Lead score ≥" },
  { value: "messageContains", label: "Message contains" },
] as const;

export const ACTION_TYPES = [
  { value: "add_tag", label: "Add tag" },
  { value: "set_priority", label: "Set priority" },
  { value: "assign", label: "Assign to" },
  { value: "create_task", label: "Create follow-up task" },
] as const;

export const TRIGGERS = [
  { value: "conversation_analyzed", label: "When a conversation is analyzed by AI" },
  { value: "inbound_message", label: "When a new inbound message arrives" },
  { value: "conversation_created", label: "When a conversation is created" },
] as const;
