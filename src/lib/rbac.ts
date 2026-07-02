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
  | "tasks:manage"
  | "sops:create"
  | "sops:approve"
  | "content:manage"
  | "qa:review"
  | "reports:view"
  | "automations:manage"
  | "ai:run"
  // ── Chat cockpit / CRM / vertical ──
  | "assistant:use" // open and message the internal AI assistant
  | "approvals:review" // approve/reject sensitive proposed actions
  | "opportunities:read"
  | "opportunities:manage"
  | "properties:read"
  | "properties:manage"
  | "social:publish"; // publish/queue social content externally

const MATRIX: Record<WorkspaceRole, Permission[]> = {
  owner: [
    "workspace:manage",
    "members:manage",
    "channels:manage",
    "conversations:read",
    "conversations:reply",
    "conversations:triage",
    "tasks:manage",
    "sops:create",
    "sops:approve",
    "content:manage",
    "qa:review",
    "reports:view",
    "automations:manage",
    "ai:run",
    "assistant:use",
    "approvals:review",
    "opportunities:read",
    "opportunities:manage",
    "properties:read",
    "properties:manage",
    "social:publish",
  ],
  admin: [
    "workspace:manage",
    "members:manage",
    "channels:manage",
    "conversations:read",
    "conversations:reply",
    "conversations:triage",
    "tasks:manage",
    "sops:create",
    "sops:approve",
    "content:manage",
    "qa:review",
    "reports:view",
    "automations:manage",
    "ai:run",
    "assistant:use",
    "approvals:review",
    "opportunities:read",
    "opportunities:manage",
    "properties:read",
    "properties:manage",
    "social:publish",
  ],
  manager: [
    "channels:manage",
    "conversations:read",
    "conversations:reply",
    "conversations:triage",
    "tasks:manage",
    "sops:create",
    "content:manage",
    "qa:review",
    "reports:view",
    "automations:manage",
    "ai:run",
    "assistant:use",
    "approvals:review",
    "opportunities:read",
    "opportunities:manage",
    "properties:read",
    "properties:manage",
    "social:publish",
  ],
  agent: [
    "conversations:read",
    "conversations:reply",
    "conversations:triage",
    "tasks:manage",
    "content:manage",
    "reports:view",
    "ai:run",
    "assistant:use",
    "opportunities:read",
    "opportunities:manage",
    "properties:read",
  ],
  reviewer: [
    "conversations:read",
    "qa:review",
    "reports:view",
    "assistant:use",
    "opportunities:read",
    "properties:read",
  ],
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
    assistant: can(role, "assistant:use"),
    command: can(role, "conversations:read"),
    inbox: can(role, "conversations:read"),
    opportunities: can(role, "opportunities:read"),
    tasks: can(role, "tasks:manage"),
    approvals: can(role, "approvals:review"),
    sops: can(role, "sops:create") || can(role, "conversations:read"),
    studio: can(role, "content:manage"),
    intelligence: can(role, "reports:view"),
    automations: can(role, "automations:manage"),
    audit: can(role, "reports:view"),
    team: can(role, "members:manage"),
    settings: can(role, "workspace:manage"),
  };
}
