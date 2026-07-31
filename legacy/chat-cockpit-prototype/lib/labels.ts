import type {
  ConversationStatus,
  Priority,
  Intent,
  Sentiment,
  ChannelType,
  TaskStatus,
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
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  email: "Email",
  sms: "SMS",
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
