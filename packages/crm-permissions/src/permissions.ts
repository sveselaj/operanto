import { UserRole } from "@operanto/crm-domain";

/**
 * The ONE permission engine (docs/OPERANTO_PERMISSION_MODEL.md).
 *
 * Extracted verbatim from the Phase 3 catalog (docs/PHASE3_DESIGN.md §14) in
 * OI-2 — role holdings are unchanged. Legacy `subject:action` strings remain
 * the wire format used by existing call sites; every permission additionally
 * has a canonical dot-namespaced name (`crm.*` / `assistant.*`) that new code
 * and future Operanto integration use. `hasPermission`/`assertPermission`
 * accept both spellings and normalize internally — one engine, two surfaces,
 * zero behavior change.
 */

export type AuthzErrorCode = "unauthenticated" | "forbidden" | "readOnly";

export class AuthzError extends Error {
  constructor(public readonly code: AuthzErrorCode) {
    super(code);
    this.name = "AuthzError";
  }
}

/** The minimal actor shape permission checks need. SessionUser satisfies it. */
export interface PermissionActor {
  role: UserRole;
}

export const PERMISSIONS = [
  "imports:view",
  "imports:create",
  "imports:commit",
  "imports:cancel",
  "imports:resolve_duplicates",
  "imports:overwrite",
  "contact_requests:view",
  "contact_requests:review",
  "contact_requests:convert",
  "contact_requests:reject",
  "contact_requests:assign",
  "integration_credentials:view",
  "integration_credentials:create",
  "integration_credentials:revoke",
  "leads:bulk_assign",
  "leads:auto_assign",
  "leads:capacity_override",
  "assignment_pools:view",
  "assignment_pools:manage",
  // ── Help assistant (docs/HELP_ASSISTANT_DESIGN.md §2) ──
  "assistant:use",
  "assistant:read_help",
  "assistant:read_own_work",
  "assistant:read_team_work",
  "assistant:read_org_work",
  // Write capabilities: declared for the future confirmation protocol but
  // mapped to NO role in the read-only release (tested in integration).
  "assistant:create_note",
  "assistant:create_callback",
  "assistant:reschedule_callback",
  "assistant:create_appointment",
  "assistant:complete_task",
  "assistant:record_call_outcome",
  "assistant:assign_lead",
  "assistant:bulk_assign",
  "assistant:process_contact_request",
  "assistant:resolve_duplicate",
  "assistant:override_capacity",
  "assistant:override_lock",
  "assistant:manage_settings",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Canonical dot-namespaced names (OI-1 §11; namespaces
 * `crm.* / assistant.* / customer.* / conversation.* / voice.* / growth.* /
 * admin.* / audit.* / notification.*` — only the first two have members in
 * this catalog today). Bijective with the legacy strings.
 */
export const CANONICAL_BY_LEGACY = {
  "imports:view": "crm.imports.view",
  "imports:create": "crm.imports.create",
  "imports:commit": "crm.imports.commit",
  "imports:cancel": "crm.imports.cancel",
  "imports:resolve_duplicates": "crm.imports.resolve_duplicates",
  "imports:overwrite": "crm.imports.overwrite",
  "contact_requests:view": "crm.contact_requests.view",
  "contact_requests:review": "crm.contact_requests.review",
  "contact_requests:convert": "crm.contact_requests.convert",
  "contact_requests:reject": "crm.contact_requests.reject",
  "contact_requests:assign": "crm.contact_requests.assign",
  "integration_credentials:view": "crm.credentials.view",
  "integration_credentials:create": "crm.credentials.create",
  "integration_credentials:revoke": "crm.credentials.revoke",
  "leads:bulk_assign": "crm.leads.bulk_assign",
  "leads:auto_assign": "crm.leads.auto_assign",
  "leads:capacity_override": "crm.leads.capacity_override",
  "assignment_pools:view": "crm.assignment_pools.view",
  "assignment_pools:manage": "crm.assignment_pools.manage",
  "assistant:use": "assistant.use",
  "assistant:read_help": "assistant.read_help",
  "assistant:read_own_work": "assistant.read_own_work",
  "assistant:read_team_work": "assistant.read_team_work",
  "assistant:read_org_work": "assistant.read_org_work",
  "assistant:create_note": "assistant.create_note",
  "assistant:create_callback": "assistant.create_callback",
  "assistant:reschedule_callback": "assistant.reschedule_callback",
  "assistant:create_appointment": "assistant.create_appointment",
  "assistant:complete_task": "assistant.complete_task",
  "assistant:record_call_outcome": "assistant.record_call_outcome",
  "assistant:assign_lead": "assistant.assign_lead",
  "assistant:bulk_assign": "assistant.bulk_assign",
  "assistant:process_contact_request": "assistant.process_contact_request",
  "assistant:resolve_duplicate": "assistant.resolve_duplicate",
  "assistant:override_capacity": "assistant.override_capacity",
  "assistant:override_lock": "assistant.override_lock",
  "assistant:manage_settings": "assistant.manage_settings",
} as const satisfies Record<Permission, string>;

export type CanonicalPermission = (typeof CANONICAL_BY_LEGACY)[Permission];
export type AnyPermission = Permission | CanonicalPermission;

const LEGACY_BY_CANONICAL = Object.fromEntries(
  Object.entries(CANONICAL_BY_LEGACY).map(([legacy, canonical]) => [canonical, legacy])
) as Record<CanonicalPermission, Permission>;

/** Normalize either spelling to the legacy wire format the matrix is keyed on. */
export function toLegacyPermission(permission: AnyPermission): Permission {
  return (LEGACY_BY_CANONICAL as Record<string, Permission>)[permission] ?? (permission as Permission);
}

/** Normalize either spelling to the canonical dot-namespaced name. */
export function toCanonicalPermission(permission: AnyPermission): CanonicalPermission {
  const canonical = (CANONICAL_BY_LEGACY as Record<string, CanonicalPermission>)[permission];
  return canonical ?? (permission as CanonicalPermission);
}

/** Assistant write capabilities — no role may hold these (read-only release). */
export const ASSISTANT_WRITE_PERMISSIONS: readonly Permission[] = [
  "assistant:create_note",
  "assistant:create_callback",
  "assistant:reschedule_callback",
  "assistant:create_appointment",
  "assistant:complete_task",
  "assistant:record_call_outcome",
  "assistant:assign_lead",
  "assistant:bulk_assign",
  "assistant:process_contact_request",
  "assistant:resolve_duplicate",
  "assistant:override_capacity",
  "assistant:override_lock",
  "assistant:manage_settings",
];

const ASSISTANT_BASE: Permission[] = [
  "assistant:use",
  "assistant:read_help",
  "assistant:read_own_work",
];

const MANAGER_PERMISSIONS: Permission[] = [
  "imports:view",
  "imports:create",
  "imports:commit",
  "imports:cancel",
  "imports:resolve_duplicates",
  "contact_requests:view",
  "contact_requests:review",
  "contact_requests:convert",
  "contact_requests:reject",
  "contact_requests:assign",
  "leads:bulk_assign",
  "leads:auto_assign",
  "leads:capacity_override",
  "assignment_pools:view",
  "assignment_pools:manage",
  ...ASSISTANT_BASE,
  "assistant:read_team_work",
];

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  // Admin: everything EXCEPT assistant write capabilities (the assistant is
  // strictly read-only — even Admin gets no assistant mutation surface).
  [UserRole.ADMIN]: new Set(
    PERMISSIONS.filter((p) => !ASSISTANT_WRITE_PERMISSIONS.includes(p))
  ),
  [UserRole.MANAGER]: new Set(MANAGER_PERMISSIONS),
  [UserRole.AGENT]: new Set<Permission>([
    // Agents see and may convert contact requests assigned to them; the
    // record-level ownership check happens in the service on top of this.
    "contact_requests:view",
    "contact_requests:convert",
    ...ASSISTANT_BASE,
  ]),
  [UserRole.AUDITOR]: new Set<Permission>([
    "imports:view",
    "contact_requests:view",
    "assignment_pools:view",
    // Auditor: read-only by nature; team/org READS are permitted.
    ...ASSISTANT_BASE,
    "assistant:read_team_work",
    "assistant:read_org_work",
  ]),
};

export function hasPermission(actor: PermissionActor, permission: AnyPermission): boolean {
  return ROLE_PERMISSIONS[actor.role].has(toLegacyPermission(permission));
}

export function assertPermission(actor: PermissionActor, permission: AnyPermission): void {
  if (!hasPermission(actor, permission)) throw new AuthzError("forbidden");
}

// ── Coarse role guards (extracted from authz-core, behavior identical) ──

export function isManagerial(actor: PermissionActor): boolean {
  return actor.role === UserRole.ADMIN || actor.role === UserRole.MANAGER;
}

export function canWrite(actor: PermissionActor): boolean {
  return actor.role !== UserRole.AUDITOR;
}

export function assertWrite(actor: PermissionActor): void {
  if (!canWrite(actor)) throw new AuthzError("readOnly");
}

export function assertManagerial(actor: PermissionActor): void {
  if (!isManagerial(actor)) throw new AuthzError("forbidden");
}
