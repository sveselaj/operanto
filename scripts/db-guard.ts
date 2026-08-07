import "dotenv/config";

/**
 * Development database guard — the mechanical answer to the C1 incident in
 * which `prisma migrate dev` was run against Neon staging because Prisma
 * migrations follow `directUrl` (DIRECT_URL), not `DATABASE_URL`, and only
 * the latter had been overridden.
 *
 * Invariant: any repository-supported DEVELOPMENT database command
 * (`pnpm db:migrate`, `pnpm db:seed`) must inspect BOTH `DATABASE_URL` and
 * `DIRECT_URL` and fail closed unless every set URL points at a local
 * database. `pnpm db:deploy` is deliberately NOT guarded — deploying
 * reviewed migrations to the shared environment is its purpose, and it runs
 * in the build pipeline.
 *
 * Override, when remote is genuinely intended from a dev shell:
 *   OPERANTO_DB_GUARD_ALLOW_REMOTE=1 pnpm db:migrate
 *
 * Output never contains credentials — hostnames only.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type GuardCheck = {
  variable: string;
  host: string | null;
  local: boolean;
};

/** Classify one database URL. Unset/empty → local:true (nothing to protect). */
export function checkDatabaseUrl(
  variable: string,
  value: string | undefined,
): GuardCheck {
  if (!value || value.trim() === "") {
    return { variable, host: null, local: true };
  }
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    // Unparseable is treated as NOT local: fail closed on anything we
    // cannot positively identify.
    return { variable, host: "<unparseable>", local: false };
  }
  return { variable, host, local: LOCAL_HOSTS.has(host.toLowerCase()) };
}

export function guardVerdict(env: {
  DATABASE_URL?: string | undefined;
  DIRECT_URL?: string | undefined;
  OPERANTO_DB_GUARD_ALLOW_REMOTE?: string | undefined;
  [key: string]: string | undefined;
}): { allowed: boolean; offending: GuardCheck[]; overridden: boolean } {
  const checks = [
    checkDatabaseUrl("DATABASE_URL", env.DATABASE_URL),
    checkDatabaseUrl("DIRECT_URL", env.DIRECT_URL),
  ];
  const offending = checks.filter((check) => !check.local);
  const overridden = env.OPERANTO_DB_GUARD_ALLOW_REMOTE === "1";
  return { allowed: offending.length === 0 || overridden, offending, overridden };
}

/* Entrypoint: exit non-zero when a shared database is targeted. */
if (process.argv[1]?.endsWith("db-guard.ts")) {
  const verdict = guardVerdict(process.env);
  if (!verdict.allowed) {
    console.error("db-guard: REFUSING to run a development database command.");
    for (const check of verdict.offending) {
      console.error(
        `  ${check.variable} points at non-local host "${check.host}".`,
      );
    }
    console.error(
      "  Prisma migrations follow DIRECT_URL — override BOTH URLs to a local",
    );
    console.error(
      "  database, e.g. postgresql://operanto:operanto@localhost:5435/operanto,",
    );
    console.error(
      "  or set OPERANTO_DB_GUARD_ALLOW_REMOTE=1 if remote is truly intended.",
    );
    process.exit(1);
  }
  if (verdict.overridden && verdict.offending.length > 0) {
    console.warn(
      `db-guard: remote database allowed by explicit override (${verdict.offending
        .map((check) => `${check.variable}→${check.host}`)
        .join(", ")}).`,
    );
  }
}
