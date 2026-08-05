import { describe, expect, it } from "vitest";
import {
  ASSISTANT_WRITE_PERMISSIONS,
  CANONICAL_BY_LEGACY,
  PERMISSIONS,
  UserRoleValues,
  assertPermission,
  hasPermission,
  toCanonicalPermission,
  toLegacyPermission,
} from "./test-helpers";

describe("canonical namespace mapping", () => {
  it("is bijective and total", () => {
    const canonicals = Object.values(CANONICAL_BY_LEGACY);
    expect(Object.keys(CANONICAL_BY_LEGACY).sort()).toEqual([...PERMISSIONS].sort());
    expect(new Set(canonicals).size).toBe(PERMISSIONS.length);
  });

  it("uses only approved namespaces", () => {
    for (const canonical of Object.values(CANONICAL_BY_LEGACY)) {
      expect(canonical).toMatch(/^(crm|assistant)\.[a-z_.]+$/);
    }
  });

  it("round-trips both spellings", () => {
    for (const legacy of PERMISSIONS) {
      const canonical = toCanonicalPermission(legacy);
      expect(toLegacyPermission(canonical)).toBe(legacy);
      expect(toCanonicalPermission(canonical)).toBe(canonical);
      expect(toLegacyPermission(legacy)).toBe(legacy);
    }
  });

  it("grants identically for legacy and canonical spellings", () => {
    for (const role of UserRoleValues) {
      for (const legacy of PERMISSIONS) {
        expect(hasPermission({ role }, toCanonicalPermission(legacy))).toBe(
          hasPermission({ role }, legacy)
        );
      }
    }
  });
});

describe("role matrix invariants", () => {
  it("maps assistant write permissions to no role at all", () => {
    for (const role of UserRoleValues) {
      for (const permission of ASSISTANT_WRITE_PERMISSIONS) {
        expect(hasPermission({ role }, permission)).toBe(false);
      }
    }
  });

  it("gives ADMIN everything except assistant writes", () => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission({ role: "ADMIN" }, permission)).toBe(
        !ASSISTANT_WRITE_PERMISSIONS.includes(permission)
      );
    }
  });

  it("keeps AUDITOR free of any mutating permission", () => {
    const auditorHeld = PERMISSIONS.filter((p) => hasPermission({ role: "AUDITOR" }, p));
    for (const p of auditorHeld) {
      expect(p).toMatch(/:(view|use|read_[a-z_]+)$/);
    }
  });

  it("throws forbidden AuthzError on a denied permission", () => {
    expect(() => assertPermission({ role: "AGENT" }, "imports:create")).toThrowError(
      expect.objectContaining({ name: "AuthzError", code: "forbidden" })
    );
  });
});
