/**
 * Audit engine contracts (OI-2). The transactional write path
 * (`recordAudit()`) stays Prisma-coupled in the application
 * (src/server/services/audit-service.ts) and MUST satisfy
 * `AuditContractInput` — asserted at compile time in that file. This package
 * owns the stable parts: the input contract and the catalog of audited action
 * names (the compliance vocabulary).
 *
 * Rules (unchanged): append-only; single write path; rows join the caller's
 * transaction. Target policy (OI-1 §3): metadata converges to ids-only —
 * before/after payloads are a legacy CRM shape scheduled for the OI-4/5 port.
 */
export interface AuditContractInput {
  organizationId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  beforeData?: unknown;
  afterData?: unknown;
  ipAddress?: string;
}

/**
 * Every audited action the CRM writes today (grep-complete at extraction
 * time). New actions are added here first — the name IS the compliance
 * contract. Format: `subject.action` (lower_snake action).
 */
export const AUDIT_ACTIONS = [
  "auth.login.success",
  "auth.login.failed",
  "lead.status_changed",
  "lead.assigned",
  "lead.bulk_assigned",
  "lead.capacity_override",
  "lead.lock_overridden",
  "lead.phone_corrected",
  "lead.import_fill",
  "lead.import_overwrite",
  "task.callback_rescheduled",
  "task.cancelled",
  "task.reopened",
  "task.reassigned",
  "call.outcome_recorded",
  "appointment.created",
  "appointment.rescheduled",
  "appointment.cancelled",
  "appointment.owner_changed",
  "import.created",
  "import.committed",
  "import.cancelled",
  "import.row_resolved",
  "contact_request.start_review",
  "contact_request.reject",
  "contact_request.spam",
  "contact_request.duplicate",
  "contact_request.archive",
  "contact_request.reopen",
  "contact_request.assigned",
  "contact_request.linked",
  "contact_request.converted",
  "integration_credential.created",
  "integration_credential.revoked",
  "assignment_pool.created",
  "assignment_pool.member_toggled",
  "lead.phone_normalized",
  "lead.phone_repair_run",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
