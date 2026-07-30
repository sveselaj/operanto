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
  | "audit:view";

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
  ],
  OPERATOR: [
    "customers:view_assigned",
    "opportunities:view_assigned",
    "opportunities:update_stage",
    "tasks:manage",
    "notes:add",
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
