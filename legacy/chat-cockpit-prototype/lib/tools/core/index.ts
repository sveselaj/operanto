import type { ToolDefinition } from "@/lib/tools/types";
import {
  searchContactsTool,
  getContactTool,
  getCustomerHistoryTool,
} from "@/lib/tools/core/contacts";
import {
  searchConversationsTool,
  summarizeConversationTool,
} from "@/lib/tools/core/conversations";
import {
  searchOpportunitiesTool,
  createOpportunityTool,
  updateOpportunityStageTool,
  assignOpportunityTool,
  updateLeadRequirementsTool,
} from "@/lib/tools/core/opportunities";
import { createTaskTool, createFollowUpTool } from "@/lib/tools/core/tasks";
import {
  draftCustomerReplyTool,
  translateMessageTool,
  sendCustomerMessageTool,
} from "@/lib/tools/core/messaging";

/** Vertical-agnostic tools available in every workspace. */
export const coreTools: ToolDefinition[] = [
  // contacts
  searchContactsTool,
  getContactTool,
  getCustomerHistoryTool,
  // conversations
  searchConversationsTool,
  summarizeConversationTool,
  // opportunities (CRM)
  searchOpportunitiesTool,
  createOpportunityTool,
  updateOpportunityStageTool,
  assignOpportunityTool,
  updateLeadRequirementsTool,
  // tasks
  createTaskTool,
  createFollowUpTool,
  // messaging
  draftCustomerReplyTool,
  translateMessageTool,
  sendCustomerMessageTool,
];
