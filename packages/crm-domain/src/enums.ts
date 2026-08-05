/**
 * Canonical CRM domain vocabulary (docs/OPERANTO_CANONICAL_DOMAIN_MODEL.md).
 *
 * Shape-compatible with the Prisma-generated enums (`{ KEY: "KEY" } as const`
 * plus the literal-union type), so application code may pass Prisma enum
 * values into package functions and vice versa. The database schema remains
 * the source of truth for persistence; THIS file is the source of truth for
 * the business language. A divergence fails `pnpm typecheck` at the first
 * assignment between the two.
 */

export const LeadStatus = {
  NEW: "NEW",
  CONTACTED: "CONTACTED",
  NO_ANSWER_1: "NO_ANSWER_1",
  NO_ANSWER_2: "NO_ANSWER_2",
  NO_ANSWER_3: "NO_ANSWER_3",
  RETRY_LATER: "RETRY_LATER",
  CALLBACK: "CALLBACK",
  APPOINTMENT: "APPOINTMENT",
  QUALIFIED: "QUALIFIED",
  CONVERTED: "CONVERTED",
  REJECTED: "REJECTED",
  LOST: "LOST",
  WRONG_NUMBER: "WRONG_NUMBER",
  UNAVAILABLE: "UNAVAILABLE",
  DO_NOT_CONTACT: "DO_NOT_CONTACT",
} as const;
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

export const ActivityOutcome = {
  CONNECTED: "CONNECTED",
  NO_ANSWER: "NO_ANSWER",
  BUSY: "BUSY",
  VOICEMAIL: "VOICEMAIL",
  WRONG_NUMBER: "WRONG_NUMBER",
  UNAVAILABLE: "UNAVAILABLE",
  CALLBACK_REQUESTED: "CALLBACK_REQUESTED",
  APPOINTMENT_BOOKED: "APPOINTMENT_BOOKED",
  QUALIFIED: "QUALIFIED",
  REJECTED: "REJECTED",
  DO_NOT_CONTACT: "DO_NOT_CONTACT",
} as const;
export type ActivityOutcome = (typeof ActivityOutcome)[keyof typeof ActivityOutcome];

export const TaskStatus = {
  OPEN: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskType = {
  CALL: "CALL",
  CALLBACK: "CALLBACK",
  EMAIL: "EMAIL",
  APPOINTMENT_PREP: "APPOINTMENT_PREP",
  DOCUMENT_REQUEST: "DOCUMENT_REQUEST",
  REVIEW: "REVIEW",
  FOLLOW_UP: "FOLLOW_UP",
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const TaskPriority = {
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
  URGENT: "URGENT",
} as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

export const AppointmentStatus = {
  SCHEDULED: "SCHEDULED",
  CONFIRMED: "CONFIRMED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  NO_SHOW: "NO_SHOW",
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

export const UserRole = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  AGENT: "AGENT",
  AUDITOR: "AUDITOR",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const ConsentStatus = {
  UNKNOWN: "UNKNOWN",
  GIVEN: "GIVEN",
  REVOKED: "REVOKED",
} as const;
export type ConsentStatus = (typeof ConsentStatus)[keyof typeof ConsentStatus];

export const ImportStrategy = {
  CREATE_NEW_ONLY: "CREATE_NEW_ONLY",
  SKIP_DUPLICATES: "SKIP_DUPLICATES",
  FILL_EMPTY_FIELDS: "FILL_EMPTY_FIELDS",
  REVIEW_ALL_MATCHES: "REVIEW_ALL_MATCHES",
  EXPLICIT_OVERWRITE: "EXPLICIT_OVERWRITE",
} as const;
export type ImportStrategy = (typeof ImportStrategy)[keyof typeof ImportStrategy];

export const PhoneStatus = {
  MISSING: "MISSING",
  VALID: "VALID",
  POSSIBLE: "POSSIBLE",
  INVALID: "INVALID",
} as const;
export type PhoneStatus = (typeof PhoneStatus)[keyof typeof PhoneStatus];

/** A task occupies the "open work" universe in exactly these states. */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  TaskStatus.OPEN,
  TaskStatus.IN_PROGRESS,
];

export const NotificationType = {
  LEAD_ASSIGNED: "LEAD_ASSIGNED",
  LEAD_REASSIGNED: "LEAD_REASSIGNED",
  CALLBACK_DUE: "CALLBACK_DUE",
  CALLBACK_OVERDUE: "CALLBACK_OVERDUE",
  APPOINTMENT_UPCOMING: "APPOINTMENT_UPCOMING",
  TASK_ASSIGNED: "TASK_ASSIGNED",
  TASK_OVERDUE: "TASK_OVERDUE",
  LOCK_OVERRIDDEN: "LOCK_OVERRIDDEN",
  IMPORT_COMPLETED: "IMPORT_COMPLETED",
  IMPORT_FAILED: "IMPORT_FAILED",
  DUPLICATE_REVIEW_REQUIRED: "DUPLICATE_REVIEW_REQUIRED",
  CONTACT_REQUEST_ASSIGNED: "CONTACT_REQUEST_ASSIGNED",
  BULK_ASSIGNMENT_COMPLETED: "BULK_ASSIGNMENT_COMPLETED",
  ASSIGNMENT_FAILED: "ASSIGNMENT_FAILED",
  CAPACITY_REACHED: "CAPACITY_REACHED",
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
