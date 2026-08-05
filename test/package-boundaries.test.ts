import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OI-2 package-boundary rules (docs/OPERANTO_SHARED_SERVICES.md):
 * engine packages are pure business logic — no framework imports, no app
 * imports, no Prisma, and an acyclic dependency graph. Runtime API surfaces
 * are pinned so accidental breaking changes fail CI.
 */

const PACKAGES_DIR = join(__dirname, "../packages");

/** npm dependencies engine packages may use (resolved from the repo root). */
const ALLOWED_EXTERNALS = new Set(["zod", "libphonenumber-js", "@date-fns/tz"]);

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Next.js", pattern: /^next(\/|$)/ },
  { name: "React", pattern: /^react(-dom)?(\/|$)/ },
  { name: "server-only", pattern: /^server-only$/ },
  { name: "app alias", pattern: /^@\// },
  { name: "Prisma", pattern: /^@prisma\/|^\.?\.?\/.*generated\/prisma/ },
  { name: "Node built-ins", pattern: /^(node:|fs$|path$|crypto$|child_process$)/ },
];

function packageNames(): string[] {
  return readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function sourceFiles(pkg: string): string[] {
  const dir = join(PACKAGES_DIR, pkg, "src");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(dir, f));
}

function importSpecifiers(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)[^"'\n]*from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) specifiers.push(match[1]);
  return specifiers;
}

describe("package boundaries", () => {
  const packages = packageNames();

  it("finds the OI-2 package set", () => {
    for (const required of [
      "crm-domain",
      "crm-phone",
      "crm-leadstatus",
      "crm-calloutcome",
      "crm-nextaction",
      "crm-workqueue",
      "crm-assignment",
      "crm-callbacks",
      "crm-appointments",
      "crm-import",
      "crm-deduplication",
      "crm-notifications",
      "crm-permissions",
      "crm-audit",
      "crm-events",
      "crm-voice",
    ]) {
      expect(packages).toContain(required);
    }
  });

  it("keeps every package free of framework/app/Prisma/Node imports", () => {
    const violations: string[] = [];
    for (const pkg of packages) {
      for (const file of sourceFiles(pkg)) {
        for (const spec of importSpecifiers(file)) {
          if (spec.startsWith(".")) continue; // package-internal
          if (spec.startsWith("@operanto/")) continue; // engine-to-engine
          if (spec === "vitest") continue; // test files only
          const base = spec.startsWith("@")
            ? spec.split("/").slice(0, 2).join("/")
            : spec.split("/")[0];
          if (ALLOWED_EXTERNALS.has(base)) continue;
          const hit = FORBIDDEN_PATTERNS.find((f) => f.pattern.test(spec));
          violations.push(`${pkg}: ${spec}${hit ? ` (${hit.name})` : " (not allowlisted)"}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("has an acyclic engine dependency graph", () => {
    const graph = new Map<string, Set<string>>();
    for (const pkg of packages) {
      const deps = new Set<string>();
      for (const file of sourceFiles(pkg)) {
        for (const spec of importSpecifiers(file)) {
          if (spec.startsWith("@operanto/")) deps.add(spec.replace("@operanto/", ""));
        }
      }
      deps.delete(pkg);
      graph.set(pkg, deps);
    }
    const visiting = new Set<string>();
    const done = new Set<string>();
    const cycles: string[] = [];
    const visit = (node: string, path: string[]): void => {
      if (done.has(node)) return;
      if (visiting.has(node)) {
        cycles.push([...path, node].join(" → "));
        return;
      }
      visiting.add(node);
      for (const dep of graph.get(node) ?? []) visit(dep, [...path, node]);
      visiting.delete(node);
      done.add(node);
    };
    for (const pkg of packages) visit(pkg, []);
    expect(cycles).toEqual([]);
  });
});

describe("stable package APIs", () => {
  it("pins the runtime export surface of every engine package", async () => {
    const surfaces: Record<string, string[]> = {
      "crm-phone": ["PhoneService", "normalizeEmail", "normalizePhone", "parsePhoneDetails", "phoneWriteFields"],
      "crm-leadstatus": [
        "ACTIVE_STATUSES",
        "CLOSED_STATUSES",
        "REASON_REQUIRED",
        "SCHEDULE_OPTIONAL",
        "SCHEDULE_REQUIRED",
        "allowedTransitions",
        "canTransition",
        "isActiveStatus",
        "isClosedStatus",
        "requiresReason",
        "requiresSchedule",
      ],
      "crm-calloutcome": [
        "OUTCOME_RULES",
        "noAnswerProgression",
        "outcomeStatusTarget",
        "planStatusPath",
        "validateOutcomeDecision",
      ],
      "crm-workqueue": [
        "APPOINTMENT_PREP_WINDOW_MS",
        "CALLBACK_DUE_WINDOW_MS",
        "QUEUE_CATEGORIES",
        "QUEUE_EXCLUDED_STATUSES",
        "buildWorkQueue",
        "isQueueEligible",
      ],
      "crm-callbacks": [
        "CALLBACK_TASK_TYPE",
        "DEFAULT_TASK_REMINDER_MINUTES",
        "OPEN_CALLBACK_STATUSES",
        "callbackPriorityFor",
        "planCallbackUpsert",
      ],
      "crm-appointments": [
        "ACTIVE_APPOINTMENT_STATUSES",
        "APPOINTMENT_HORIZON_MS",
        "DEFAULT_APPOINTMENT_REMINDER_MINUTES",
        "MAX_REMINDER_MINUTES",
        "overlapsSlot",
        "validateAppointmentTimes",
      ],
    };
    for (const [pkg, expected] of Object.entries(surfaces)) {
      const mod: Record<string, unknown> = await import(`@operanto/${pkg}`);
      for (const name of expected) {
        expect(Object.keys(mod), `${pkg} is missing export ${name}`).toContain(name);
      }
    }
  });
});
