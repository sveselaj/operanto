import { describe, expect, it } from "vitest";
import type { MembershipRole } from "@prisma/client";
import { can, type Permission } from "@/lib/rbac";
import { roleRequiresTwoFactor } from "@/lib/services/two-factor";

/**
 * OI-3 RBAC invariants: the crm.* family follows the OI permission model's
 * role mapping, and the new AUDITOR role is structurally read-only.
 */

const ROLES: MembershipRole[] = ["ADMIN", "SUPERVISOR", "OPERATOR", "AUDITOR"];

const CRM_PERMISSIONS: Permission[] = [
  "crm.view",
  "crm.leads.view_all",
  "crm.leads.view_assigned",
  "crm.leads.create",
  "crm.leads.transition",
  "crm.leads.assign",
];

describe("crm permission family", () => {
  it("maps roles per the OI permission model", () => {
    for (const p of CRM_PERMISSIONS) {
      expect(can("ADMIN", p), `ADMIN ${p}`).toBe(true);
      expect(can("SUPERVISOR", p), `SUPERVISOR ${p}`).toBe(true);
    }
    expect(can("OPERATOR", "crm.view")).toBe(true);
    expect(can("OPERATOR", "crm.leads.view_assigned")).toBe(true);
    expect(can("OPERATOR", "crm.leads.transition")).toBe(true);
    expect(can("OPERATOR", "crm.leads.view_all")).toBe(false);
    expect(can("OPERATOR", "crm.leads.create")).toBe(false);
    expect(can("OPERATOR", "crm.leads.assign")).toBe(false);
  });
});

describe("AUDITOR role", () => {
  it("holds only view/read permissions", () => {
    const held = (
      [
        "org:manage",
        "members:manage",
        "integrations:manage",
        "customers:view_all",
        "opportunities:view_all",
        "opportunities:update_stage",
        "tasks:manage",
        "notes:add",
        "activity:view_all",
        "audit:view",
        "privacy:manage",
        "conversations:view_all",
        "conversations:message",
        "messages:send",
        "approvals:decide",
        "ai:run",
        "ai:configure",
        "growth:view_audit",
        ...CRM_PERMISSIONS,
      ] as Permission[]
    ).filter((p) => can("AUDITOR", p));
    for (const p of held) {
      expect(p, `AUDITOR must not hold mutating permission ${p}`).toMatch(
        /(:view|:view_all|:view_assigned|:view_audit|^crm\.view$|\.view_all$|\.view_assigned$)/,
      );
    }
    // And it does hold the org-wide read set.
    expect(can("AUDITOR", "audit:view")).toBe(true);
    expect(can("AUDITOR", "activity:view_all")).toBe(true);
    expect(can("AUDITOR", "crm.leads.view_all")).toBe(true);
    // Conversations (message content) are deliberately excluded.
    expect(can("AUDITOR", "conversations:view_all")).toBe(false);
  });

  it("requires a second factor like the other privileged roles", () => {
    for (const role of ROLES) {
      expect(roleRequiresTwoFactor(role)).toBe(role !== "OPERATOR");
    }
  });
});
