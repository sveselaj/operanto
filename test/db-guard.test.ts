import { describe, expect, it } from "vitest";
import { checkDatabaseUrl, guardVerdict } from "../scripts/db-guard";

/**
 * The development database guard (C2 hardening after the C1 incident):
 * db:migrate / db:seed must fail closed when EITHER DATABASE_URL or
 * DIRECT_URL points at a shared database — Prisma migrations follow
 * DIRECT_URL, so checking one variable is not enough.
 */

const LOCAL = "postgresql://operanto:operanto@localhost:5435/operanto";
const REMOTE =
  "postgresql://user:secret@ep-long-mountain-axv2gsmu.c-4.us-east-2.aws.neon.tech/neondb";

describe("checkDatabaseUrl", () => {
  it("accepts local hosts", () => {
    expect(checkDatabaseUrl("DATABASE_URL", LOCAL).local).toBe(true);
    expect(
      checkDatabaseUrl("DATABASE_URL", "postgresql://a:b@127.0.0.1:5432/x").local,
    ).toBe(true);
  });

  it("flags remote hosts without exposing credentials", () => {
    const check = checkDatabaseUrl("DIRECT_URL", REMOTE);
    expect(check.local).toBe(false);
    expect(check.host).not.toContain("secret");
    expect(check.host).not.toContain("user");
  });

  it("treats unset as safe and unparseable as remote (fail closed)", () => {
    expect(checkDatabaseUrl("DIRECT_URL", undefined).local).toBe(true);
    expect(checkDatabaseUrl("DIRECT_URL", "").local).toBe(true);
    expect(checkDatabaseUrl("DIRECT_URL", "not a url").local).toBe(false);
  });
});

describe("guardVerdict", () => {
  it("allows all-local", () => {
    expect(
      guardVerdict({ DATABASE_URL: LOCAL, DIRECT_URL: LOCAL }).allowed,
    ).toBe(true);
  });

  it("refuses when only DIRECT_URL is remote — the exact C1 incident", () => {
    const verdict = guardVerdict({ DATABASE_URL: LOCAL, DIRECT_URL: REMOTE });
    expect(verdict.allowed).toBe(false);
    expect(verdict.offending.map((check) => check.variable)).toEqual([
      "DIRECT_URL",
    ]);
  });

  it("refuses when only DATABASE_URL is remote", () => {
    expect(
      guardVerdict({ DATABASE_URL: REMOTE, DIRECT_URL: LOCAL }).allowed,
    ).toBe(false);
  });

  it("explicit override allows remote, and only the exact value works", () => {
    expect(
      guardVerdict({
        DATABASE_URL: REMOTE,
        OPERANTO_DB_GUARD_ALLOW_REMOTE: "1",
      }).allowed,
    ).toBe(true);
    expect(
      guardVerdict({
        DATABASE_URL: REMOTE,
        OPERANTO_DB_GUARD_ALLOW_REMOTE: "true",
      }).allowed,
    ).toBe(false);
  });
});
