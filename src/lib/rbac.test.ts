import { describe, it, expect } from "vitest";
import { can, requirePermission, visibleModules, ForbiddenError } from "@/lib/rbac";

describe("can", () => {
  it("grants owners and admins every permission", () => {
    for (const p of [
      "workspace:manage",
      "members:manage",
      "channels:manage",
      "sops:approve",
      "automations:manage",
      "ai:run",
    ] as const) {
      expect(can("owner", p)).toBe(true);
      expect(can("admin", p)).toBe(true);
    }
  });

  it("lets agents reply but not manage the workspace or approve SOPs", () => {
    expect(can("agent", "conversations:reply")).toBe(true);
    expect(can("agent", "workspace:manage")).toBe(false);
    expect(can("agent", "sops:approve")).toBe(false);
    expect(can("agent", "sops:create")).toBe(false);
  });

  it("lets managers create SOPs but not approve them", () => {
    expect(can("manager", "sops:create")).toBe(true);
    expect(can("manager", "sops:approve")).toBe(false);
  });

  it("restricts reviewers to read, QA, and reports", () => {
    expect(can("reviewer", "conversations:read")).toBe(true);
    expect(can("reviewer", "qa:review")).toBe(true);
    expect(can("reviewer", "reports:view")).toBe(true);
    expect(can("reviewer", "conversations:reply")).toBe(false);
    expect(can("reviewer", "conversations:triage")).toBe(false);
  });

  it("restricts client_viewer to reports only", () => {
    expect(can("client_viewer", "reports:view")).toBe(true);
    expect(can("client_viewer", "conversations:read")).toBe(false);
  });
});

describe("requirePermission", () => {
  it("is a no-op when the role has the permission", () => {
    expect(() => requirePermission("owner", "workspace:manage")).not.toThrow();
  });

  it("throws ForbiddenError naming the missing permission", () => {
    expect(() => requirePermission("agent", "workspace:manage")).toThrow(ForbiddenError);
    expect(() => requirePermission("agent", "workspace:manage")).toThrow(/workspace:manage/);
  });
});

describe("visibleModules", () => {
  it("hides admin-only modules from agents", () => {
    const mods = visibleModules("agent");
    expect(mods.inbox).toBe(true);
    expect(mods.tasks).toBe(true);
    expect(mods.team).toBe(false);
    expect(mods.settings).toBe(false);
    expect(mods.automations).toBe(false);
  });

  it("shows everything to owners", () => {
    const mods = visibleModules("owner");
    expect(Object.values(mods).every(Boolean)).toBe(true);
  });

  it("shows reviewers reports/inbox/sops but not studio or automations", () => {
    const mods = visibleModules("reviewer");
    expect(mods.intelligence).toBe(true);
    expect(mods.inbox).toBe(true);
    expect(mods.sops).toBe(true); // visible via conversations:read
    expect(mods.studio).toBe(false);
    expect(mods.automations).toBe(false);
  });
});
