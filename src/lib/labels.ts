import type {
  ConversationStatus,
  Priority,
  Intent,
  Sentiment,
  ChannelType,
  TaskStatus,
  MessageStatus,
  ConsentStatus,
  ConversationHandling,
  OpportunityStatus,
  QuoteStatus,
  ApprovalStatus,
} from "@prisma/client";

type BadgeVariant = "default" | "primary" | "success" | "warning" | "danger" | "outline";

export const statusLabel: Record<ConversationStatus, string> = {
  open: "Open",
  pending: "Pending",
  waiting_customer: "Waiting on customer",
  resolved: "Resolved",
  archived: "Archived",
};

export const statusVariant: Record<ConversationStatus, BadgeVariant> = {
  open: "primary",
  pending: "warning",
  waiting_customer: "outline",
  resolved: "success",
  archived: "default",
};

export const priorityLabel: Record<Priority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const priorityVariant: Record<Priority, BadgeVariant> = {
  low: "default",
  normal: "outline",
  high: "warning",
  urgent: "danger",
};

export const intentLabel: Record<Intent, string> = {
  pricing_inquiry: "Pricing inquiry",
  product_inquiry: "Product inquiry",
  service_inquiry: "Service inquiry",
  appointment_request: "Appointment request",
  complaint: "Complaint",
  refund_request: "Refund request",
  delivery_question: "Delivery question",
  technical_support: "Technical support",
  partnership_inquiry: "Partnership inquiry",
  spam: "Spam",
  unclear: "Unclear",
  urgent_issue: "Urgent issue",
  qualified_lead: "Qualified lead",
};

export const sentimentLabel: Record<Sentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  frustrated: "Frustrated",
  angry: "Angry",
  confused: "Confused",
  urgent: "Urgent",
  happy: "Happy",
  disappointed: "Disappointed",
};

export const channelLabel: Record<ChannelType, string> = {
  instagram: "Instagram",
  facebook: "Messenger",
  whatsapp: "WhatsApp",
  email: "Email",
  sms: "SMS",
  telegram: "Telegram",
  viber: "Viber",
  webchat: "Web chat",
  manual: "Manual",
};

export const taskStatusLabel: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

export const taskStatusVariant: Record<TaskStatus, BadgeVariant> = {
  todo: "outline",
  in_progress: "primary",
  blocked: "danger",
  done: "success",
  cancelled: "default",
};

// ── MediaSync communication layer ──

export const messageStatusLabel: Record<MessageStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
};

export const consentStatusLabel: Record<ConsentStatus, string> = {
  unknown: "Consent unknown",
  opted_in: "Opted in",
  opted_out: "Opted out",
};

export const consentStatusVariant: Record<ConsentStatus, BadgeVariant> = {
  unknown: "outline",
  opted_in: "success",
  opted_out: "danger",
};

export const handlingLabel: Record<ConversationHandling, string> = {
  ai: "AI handling",
  human: "Human handling",
};

// ── Operational layer ──

export const opportunityStatusLabel: Record<OpportunityStatus, string> = {
  open: "Open",
  won: "Won",
  lost: "Lost",
  abandoned: "Abandoned",
};

export const opportunityStatusVariant: Record<OpportunityStatus, BadgeVariant> = {
  open: "primary",
  won: "success",
  lost: "danger",
  abandoned: "default",
};

export const quoteStatusLabel: Record<QuoteStatus, string> = {
  draft: "Draft",
  reviewed: "Reviewed",
  approved: "Approved",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

export const quoteStatusVariant: Record<QuoteStatus, BadgeVariant> = {
  draft: "outline",
  reviewed: "default",
  approved: "primary",
  sent: "warning",
  accepted: "success",
  declined: "danger",
  expired: "default",
};

export const approvalStatusLabel: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const approvalStatusVariant: Record<ApprovalStatus, BadgeVariant> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "default",
};

/** Human label for a gated approval action. */
export const approvalActionLabel: Record<string, string> = {
  "quote.send": "Send quote",
  "price.override": "Price override",
};
