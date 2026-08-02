import type { MembershipRole } from "@prisma/client";

/**
 * Role → permission matrix. Pure and static: authorization decisions read the
 * CURRENT membership from the database (see org-context.ts), then consult this
 * matrix. Record-level access (assignment) is checked separately where it
 * applies — a permission here is necessary, not sufficient.
 */

export type Permission =
  | "org:manage"
  | "members:manage"
  | "integrations:manage"
  | "customers:view_all"
  | "customers:view_assigned"
  | "opportunities:view_all"
  | "opportunities:view_assigned"
  | "opportunities:assign"
  | "opportunities:update_stage"
  | "tasks:manage"
  | "notes:add"
  | "activity:view_all"
  | "audit:view"
  /** Erasure and restriction of processing — organisation-wide effect. */
  | "privacy:manage"
  | "conversations:view_all"
  | "conversations:view_assigned"
  | "conversations:create"
  /** Status and priority changes. Archiving is gated separately. */
  | "conversations:update"
  | "conversations:archive"
  | "conversations:assign"
  /** Linking/unlinking a Customer changes what personal data a conversation
   *  exposes, so it is held to the supervisor tier. */
  | "conversations:link_customer"
  | "conversations:note"
  | "conversations:message"
  /** Explicit human control of a conversation's handling state. */
  | "conversations:takeover"
  /** Request AI assistance (summary, classification, drafts). */
  | "ai:run"
  /** Read AI results and configuration state. */
  | "ai:read"
  /** Change tenant AI configuration (enable, mode, model, budgets). */
  | "ai:configure"
  | "approvals:read"
  | "approvals:decide";

const MATRIX: Record<MembershipRole, Permission[]> = {
  ADMIN: [
    "org:manage",
    "members:manage",
    "integrations:manage",
    "customers:view_all",
    "customers:view_assigned",
    "opportunities:view_all",
    "opportunities:view_assigned",
    "opportunities:assign",
    "opportunities:update_stage",
    "tasks:manage",
    "notes:add",
    "activity:view_all",
    "audit:view",
    "privacy:manage",
    "conversations:view_all",
    "conversations:view_assigned",
    "conversations:create",
    "conversations:update",
    "conversations:archive",
    "conversations:assign",
    "conversations:link_customer",
    "conversations:note",
    "conversations:message",
    "conversations:takeover",
    "ai:run",
    "ai:read",
    "ai:configure",
    "approvals:read",
    "approvals:decide",
  ],
  SUPERVISOR: [
    "customers:view_all",
    "customers:view_assigned",
    "opportunities:view_all",
    "opportunities:view_assigned",
    "opportunities:assign",
    "opportunities:update_stage",
    "tasks:manage",
    "notes:add",
    "activity:view_all",
    "conversations:view_all",
    "conversations:view_assigned",
    "conversations:create",
    "conversations:update",
    "conversations:archive",
    "conversations:assign",
    "conversations:link_customer",
    "conversations:note",
    "conversations:message",
    "conversations:takeover",
    "ai:run",
    "ai:read",
    "approvals:read",
    "approvals:decide",
  ],
  OPERATOR: [
    "customers:view_assigned",
    "opportunities:view_assigned",
    "opportunities:update_stage",
    "tasks:manage",
    "notes:add",
    "conversations:view_assigned",
    "conversations:create",
    "conversations:update",
    "conversations:note",
    "conversations:message",
    "conversations:takeover",
    "ai:run",
    "ai:read",
  ],
};

export function can(role: MembershipRole, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false;
}

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export function requirePermission(
  role: MembershipRole,
  permission: Permission,
): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}
