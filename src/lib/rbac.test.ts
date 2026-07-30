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

describe("requirePermission", () => {
  it("throws ForbiddenError with the permission name", () => {
    expect(() => requirePermission("OPERATOR", "members:manage")).toThrow(
      ForbiddenError,
    );
    expect(() => requirePermission("ADMIN", "members:manage")).not.toThrow();
  });
});
