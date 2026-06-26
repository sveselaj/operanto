import type { WorkspaceRole } from "@prisma/client";

/**
 * Permission model for Operanto.
 *
 * Authorization is enforced server-side. The UI may hide controls, but every
 * mutation must call `requirePermission` (or `can`) before acting. This is the
 * single source of truth for "who can do what" — see docs/BLUEPRINT.md §12.
 */
export type Permission =
  | "workspace:manage"
  | "members:manage"
  | "channels:manage"
  | "conversations:read"
  | "conversations:reply" // send outbound to a customer
  | "conversations:triage" // assign, tag, change status
  | "messaging:manage" // MediaSync: templates, consent, diagnostics
  | "opportunities:manage" // Lead Engine: opportunities + requirements
  | "catalog:manage" // Catalogue: products + business rules
  | "quotes:manage" // Quoting: create/edit quotes
  | "approvals:decide" // Approvals: approve/reject gated actions
  | "workflow:manage" // Workflow engine: start/advance instances
  | "appointments:manage" // Scheduling: book/manage appointments
  | "integrations:manage" // Integration Hub: CRM/ERP pushes
  | "tasks:manage"
  | "sops:create"
  | "sops:approve"
  | "content:manage"
  | "qa:review"
  | "reports:view"
  | "automations:manage"
  | "ai:run";

const MATRIX: Record<WorkspaceRole, Permission[]> = {
  owner: [
    "workspace:manage",
    "members:manage",
    "channels:manage",
    "conversations:read",
    "conversations:reply",
    "conversations:triage",
    "messaging:manage",
    "opportunities:manage",
    "catalog:manage",
    "quotes:manage",
    "approvals:decide",
    "workflow:manage",
    "appointments:manage",
    "integrations:manage",
    "tasks:manage",
    "sops:create",
    "sops:approve",
    "content:manage",
    "qa:review",
    "reports:view",
    "automations:manage",
    "ai:run",
  ],
  admin: [
    "workspace:manage",
    "members:manage",
    "channels:manage",
    "conversations:read",
    "conversations:reply",
    "conversations:triage",
    "messaging:manage",
    "opportunities:manage",
    "catalog:manage",
    "quotes:manage",
    "approvals:decide",
    "workflow:manage",
    "appointments:manage",
    "integrations:manage",
    "tasks:manage",
    "sops:create",
    "sops:approve",
    "content:manage",
    "qa:review",
    "reports:view",
    "automations:manage",
    "ai:run",
  ],
  manager: [
    "channels:manage",
    "conversations:read",
    "conversations:reply",
    "conversations:triage",
    "messaging:manage",
    "opportunities:manage",
    "catalog:manage",
    "quotes:manage",
    "approvals:decide",
    "workflow:manage",
    "appointments:manage",
    "integrations:manage",
    "tasks:manage",
    "sops:create",
    "content:manage",
    "qa:review",
    "reports:view",
    "automations:manage",
    "ai:run",
  ],
  agent: [
    "conversations:read",
    "conversations:reply",
    "conversations:triage",
    "opportunities:manage",
    "quotes:manage",
    "workflow:manage",
    "appointments:manage",
    "tasks:manage",
    "content:manage",
    "reports:view",
    "ai:run",
  ],
  reviewer: ["conversations:read", "qa:review", "reports:view"],
  client_viewer: ["reports:view"],
};

export function can(role: WorkspaceRole, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false;
}

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`Forbidden: missing permission "${permission}"`);
    this.name = "ForbiddenError";
  }
}

export function requirePermission(role: WorkspaceRole, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}

/** Modules a role may see in navigation. Server still enforces per-action. */
export function visibleModules(role: WorkspaceRole) {
  return {
    command: can(role, "conversations:read"),
    inbox: can(role, "conversations:read"),
    opportunities: can(role, "opportunities:manage"),
    approvals: can(role, "approvals:decide") || can(role, "quotes:manage"),
    tasks: can(role, "tasks:manage"),
    sops: can(role, "sops:create") || can(role, "conversations:read"),
    studio: can(role, "content:manage"),
    intelligence: can(role, "reports:view"),
    automations: can(role, "automations:manage"),
    team: can(role, "members:manage"),
    settings: can(role, "workspace:manage"),
  };
}
