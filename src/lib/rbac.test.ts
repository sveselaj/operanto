import { describe, expect, it } from "vitest";
import { can, ForbiddenError, requirePermission } from "@/lib/rbac";

describe("role matrix", () => {
  it("ADMIN can manage members, integrations, and view audit", () => {
    expect(can("ADMIN", "members:manage")).toBe(true);
    expect(can("ADMIN", "integrations:manage")).toBe(true);
    expect(can("ADMIN", "audit:view")).toBe(true);
  });

  it("SUPERVISOR can see and assign all work but not manage the platform", () => {
    expect(can("SUPERVISOR", "opportunities:view_all")).toBe(true);
    expect(can("SUPERVISOR", "opportunities:assign")).toBe(true);
    expect(can("SUPERVISOR", "members:manage")).toBe(false);
    expect(can("SUPERVISOR", "integrations:manage")).toBe(false);
    expect(can("SUPERVISOR", "audit:view")).toBe(false);
  });

  it("OPERATOR is limited to assigned work", () => {
    expect(can("OPERATOR", "opportunities:view_assigned")).toBe(true);
    expect(can("OPERATOR", "opportunities:update_stage")).toBe(true);
    expect(can("OPERATOR", "tasks:manage")).toBe(true);
    expect(can("OPERATOR", "opportunities:view_all")).toBe(false);
    expect(can("OPERATOR", "opportunities:assign")).toBe(false);
    expect(can("OPERATOR", "customers:view_all")).toBe(false);
    expect(can("OPERATOR", "members:manage")).toBe(false);
    expect(can("OPERATOR", "integrations:manage")).toBe(false);
    expect(can("OPERATOR", "audit:view")).toBe(false);
  });
});

describe("conversation permissions", () => {
  it("ADMIN and SUPERVISOR hold the full conversation set", () => {
    for (const role of ["ADMIN", "SUPERVISOR"] as const) {
      expect(can(role, "conversations:view_all")).toBe(true);
      expect(can(role, "conversations:create")).toBe(true);
      expect(can(role, "conversations:update")).toBe(true);
      expect(can(role, "conversations:archive")).toBe(true);
      expect(can(role, "conversations:assign")).toBe(true);
      expect(can(role, "conversations:link_customer")).toBe(true);
      expect(can(role, "conversations:note")).toBe(true);
      expect(can(role, "conversations:message")).toBe(true);
    }
  });

  it("OPERATOR works assigned conversations but cannot assign, archive, or relink", () => {
    expect(can("OPERATOR", "conversations:view_assigned")).toBe(true);
    expect(can("OPERATOR", "conversations:create")).toBe(true);
    expect(can("OPERATOR", "conversations:update")).toBe(true);
    expect(can("OPERATOR", "conversations:note")).toBe(true);
    expect(can("OPERATOR", "conversations:message")).toBe(true);
    expect(can("OPERATOR", "conversations:view_all")).toBe(false);
    expect(can("OPERATOR", "conversations:assign")).toBe(false);
    expect(can("OPERATOR", "conversations:archive")).toBe(false);
    expect(can("OPERATOR", "conversations:link_customer")).toBe(false);
  });
});

describe("AI and approval permissions", () => {
  it("all roles may request and read AI assistance; only ADMIN configures", () => {
    for (const role of ["ADMIN", "SUPERVISOR", "OPERATOR"] as const) {
      expect(can(role, "ai:run")).toBe(true);
      expect(can(role, "ai:read")).toBe(true);
      expect(can(role, "conversations:takeover")).toBe(true);
    }
    expect(can("ADMIN", "ai:configure")).toBe(true);
    expect(can("SUPERVISOR", "ai:configure")).toBe(false);
    expect(can("OPERATOR", "ai:configure")).toBe(false);
  });

  it("approval decisions stay at the supervisor tier", () => {
    expect(can("ADMIN", "approvals:decide")).toBe(true);
    expect(can("SUPERVISOR", "approvals:decide")).toBe(true);
    expect(can("OPERATOR", "approvals:decide")).toBe(false);
    expect(can("OPERATOR", "approvals:read")).toBe(false);
  });
});

describe("channel and consent permissions", () => {
  it("channel administration is ADMIN-only; consent corrections supervisor+", () => {
    expect(can("ADMIN", "channels:manage")).toBe(true);
    expect(can("SUPERVISOR", "channels:manage")).toBe(false);
    expect(can("OPERATOR", "channels:manage")).toBe(false);
    expect(can("ADMIN", "consent:manage")).toBe(true);
    expect(can("SUPERVISOR", "consent:manage")).toBe(true);
    expect(can("OPERATOR", "consent:manage")).toBe(false);
  });
});

describe("requirePermission", () => {
  it("throws ForbiddenError with the permission name", () => {
    expect(() => requirePermission("OPERATOR", "members:manage")).toThrow(
      ForbiddenError,
    );
    expect(() => requirePermission("ADMIN", "members:manage")).not.toThrow();
  });
});
