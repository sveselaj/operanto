import { describe, expect, it } from "vitest";
import { ImportStrategy } from "@operanto/crm-domain";
import { detectDelimiter, stripBom } from "./csv";
import {
  applyMapping,
  suggestMapping,
  validateMapping,
  type ColumnMapping,
} from "./mapping";
import {
  classifyRow,
  normalizeMappedRow,
  parseAmount,
  parseBooleanFlag,
  parseImportDate,
  normalizeName,
} from "./normalize-row";
import {
  buildDuplicateLookup,
  classifyDuplicate,
  createSeenInFile,
  levenshtein,
  namesSimilar,
  rememberRow,
  type LeadSnapshot,
} from "@operanto/crm-deduplication";
import { dispositionFor } from "./strategy";
import { buildCsv, sanitizeCsvCell } from "./csv-sanitize";

const NOW = new Date("2026-08-04T12:00:00Z");
const OPTS = { numberLocale: "de" as const, timezone: "Europe/Berlin", defaultCurrency: "EUR", now: NOW };

describe("delimiter detection", () => {
  it("detects semicolon (German default)", () => {
    expect(detectDelimiter("Name;Telefon;E-Mail\nMax;030 1;m@x.de")).toBe(";");
  });
  it("detects comma and tab", () => {
    expect(detectDelimiter("name,phone,email\na,b,c")).toBe(",");
    expect(detectDelimiter("name\tphone\temail\na\tb\tc")).toBe("\t");
  });
  it("ignores delimiters inside quotes", () => {
    expect(detectDelimiter('Name;Notiz\n"Müller, GmbH";hallo')).toBe(";");
  });
  it("strips BOM", () => {
    expect(stripBom("﻿Name;x")).toBe("Name;x");
  });
});

describe("mapping suggestions", () => {
  it("maps common German headers", () => {
    expect(suggestMapping(["Vorname", "Nachname", "Firma", "Telefonnummer", "E-Mail"])).toEqual([
      "firstName",
      "lastName",
      "companyName",
      "phone",
      "email",
    ]);
  });
  it("never suggests the same target twice", () => {
    expect(suggestMapping(["Telefon", "Rufnummer"])).toEqual(["phone", null]);
  });
  it("requires an identity field", () => {
    expect(validateMapping(["note", null] as ColumnMapping, 2)).toContain("noIdentityField");
    expect(validateMapping(["phone", null] as ColumnMapping, 2)).toEqual([]);
  });
  it("rejects duplicate targets", () => {
    expect(validateMapping(["phone", "phone"] as ColumnMapping, 2)).toContain("duplicateTarget");
  });
  it("applies mapping and drops empty cells", () => {
    expect(applyMapping(["Max", "", " 030 1234567 "], ["firstName", "lastName", "phone"])).toEqual(
      { firstName: "Max", phone: "030 1234567" }
    );
  });
});

describe("normalization", () => {
  it("parses German amounts deterministically", () => {
    expect(parseAmount("1.234,56", "de")).toBe(1234.56);
    expect(parseAmount("1.234", "de")).toBe(1234);
    expect(parseAmount("12,5", "de")).toBe(12.5);
    expect(parseAmount("2.500 €", "de")).toBe(2500);
    expect(parseAmount("12.34", "de")).toBeNull(); // invalid German grouping
    expect(parseAmount("1234.56", "iso")).toBe(1234.56);
    expect(parseAmount("1.234,56", "iso")).toBeNull();
  });

  it("parses only approved date formats and rejects impossible dates", () => {
    expect(parseImportDate("24.12.2025", "Europe/Berlin")?.toISOString()).toBe(
      "2025-12-23T23:00:00.000Z"
    );
    expect(parseImportDate("2025-12-24 10:30", "Europe/Berlin")).not.toBeNull();
    expect(parseImportDate("31.02.2025", "Europe/Berlin")).toBeNull();
    expect(parseImportDate("12/24/2025", "Europe/Berlin")).toBeNull();
  });

  it("preserves names without title-casing", () => {
    expect(normalizeName("  von   der  Leyen ")).toBe("von der Leyen");
    expect(normalizeName("MÜLLER GmbH & Co. KG")).toBe("MÜLLER GmbH & Co. KG");
  });

  it("only accepts explicit boolean flags", () => {
    expect(parseBooleanFlag("Ja")).toBe(true);
    expect(parseBooleanFlag("nein")).toBe(false);
    expect(parseBooleanFlag("vielleicht")).toBeNull();
  });

  it("splits fullName only by the documented safe rule", () => {
    const split = normalizeMappedRow({ fullName: "Max Peter Mustermann", phone: "030 1234567" }, OPTS);
    expect(split.data.firstName).toBe("Max Peter");
    expect(split.data.lastName).toBe("Mustermann");
    const comma = normalizeMappedRow({ fullName: "Mustermann, Max", phone: "030 1234567" }, OPTS);
    expect(comma.data.firstName).toBeUndefined();
  });

  it("classifies rows: identity required, invalid phone ≠ missing phone", () => {
    const noIdentity = normalizeMappedRow({ fullName: "Max Muster" }, OPTS);
    expect(classifyRow(noIdentity.issues)).toBe("INVALID");
    expect(noIdentity.issues.some((i) => i.code === "no_contact_identity")).toBe(true);

    const validPhone = normalizeMappedRow({ phone: "030 1234567" }, OPTS);
    expect(classifyRow(validPhone.issues)).toBe("VALID_WITH_WARNINGS"); // missing name warning

    const invalidPhoneWithRef = normalizeMappedRow(
      { phone: "abc", externalReference: "X-1", fullName: "Max", source: "Web" },
      OPTS
    );
    expect(classifyRow(invalidPhoneWithRef.issues)).toBe("VALID_WITH_WARNINGS");
  });
});

// ─────────────────────────────── Duplicates ───────────────────────────────

function snapshot(overrides: Partial<LeadSnapshot>): LeadSnapshot {
  return {
    id: "lead-1",
    fullName: "Max Mustermann",
    companyName: null,
    normalizedPhone: null,
    normalizedSecondaryPhone: null,
    normalizedEmail: null,
    source: null,
    externalReference: null,
    doNotCall: false,
    ...overrides,
  };
}

describe("duplicate ladder", () => {
  it("matches exact phone, email and source+reference in order", () => {
    const lookup = buildDuplicateLookup([
      snapshot({ id: "p", normalizedPhone: "+49301234567" }),
      snapshot({ id: "e", normalizedEmail: "max@example.com" }),
      snapshot({ id: "r", source: "Web", externalReference: "REF-1" }),
    ]);
    const seen = createSeenInFile();
    expect(classifyDuplicate({ normalizedPhone: "+49301234567" }, lookup, seen)).toMatchObject({
      kind: "EXACT",
      leadId: "p",
      reasons: ["phone_match"],
    });
    expect(classifyDuplicate({ normalizedEmail: "max@example.com" }, lookup, seen)).toMatchObject({
      kind: "EXACT",
      leadId: "e",
    });
    expect(
      classifyDuplicate({ source: "web", externalReference: "ref-1" }, lookup, seen)
    ).toMatchObject({ kind: "EXACT", leadId: "r", reasons: ["reference_match"] });
  });

  it("multiple identifiers on ONE lead stay EXACT with all reasons", () => {
    const lookup = buildDuplicateLookup([
      snapshot({ id: "x", normalizedPhone: "+49301234567", normalizedEmail: "max@example.com" }),
    ]);
    const result = classifyDuplicate(
      { normalizedPhone: "+49301234567", normalizedEmail: "max@example.com" },
      lookup,
      createSeenInFile()
    );
    expect(result).toMatchObject({ kind: "EXACT", leadId: "x" });
    if (result.kind === "EXACT") {
      expect(result.reasons).toEqual(["phone_match", "email_match"]);
    }
  });

  it("CRITICAL: identifiers pointing at different leads are a CONFLICT", () => {
    const lookup = buildDuplicateLookup([
      snapshot({ id: "a", normalizedPhone: "+49301234567" }),
      snapshot({ id: "b", normalizedEmail: "max@example.com" }),
    ]);
    const result = classifyDuplicate(
      { normalizedPhone: "+49301234567", normalizedEmail: "max@example.com" },
      lookup,
      createSeenInFile()
    );
    expect(result.kind).toBe("CONFLICT");
    if (result.kind === "CONFLICT") expect(result.leadIds).toEqual(["a", "b"]);
  });

  it("detects in-file duplicates", () => {
    const lookup = buildDuplicateLookup([]);
    const seen = createSeenInFile();
    const first = { normalizedPhone: "+49301234567" };
    expect(classifyDuplicate(first, lookup, seen).kind).toBe("UNIQUE");
    rememberRow(first, seen);
    expect(classifyDuplicate({ normalizedPhone: "+49301234567" }, lookup, seen).kind).toBe(
      "FILE_DUPLICATE"
    );
  });

  it("possible duplicates via company + similar name (never auto-merged)", () => {
    const lookup = buildDuplicateLookup([
      snapshot({ id: "c", fullName: "Max Mustermann", companyName: "Muster GmbH" }),
    ]);
    const result = classifyDuplicate(
      { fullName: "Max Musterman", companyName: "Muster GmbH" },
      lookup,
      createSeenInFile()
    );
    expect(result).toMatchObject({ kind: "POSSIBLE", leadId: "c" });
  });

  it("similarity helpers are deterministic and documented", () => {
    expect(levenshtein("Meyer", "Meier")).toBeLessThanOrEqual(2);
    expect(namesSimilar("Max Mustermann", "Mustermann")).toBe(true);
    expect(namesSimilar("Max Mustermann", "Erika Schulz")).toBe(false);
  });
});

describe("strategy dispositions", () => {
  it.each([
    [ImportStrategy.CREATE_NEW_ONLY, "EXACT", "SKIP"],
    [ImportStrategy.CREATE_NEW_ONLY, "POSSIBLE", "SKIP"],
    [ImportStrategy.SKIP_DUPLICATES, "EXACT", "SKIP"],
    [ImportStrategy.SKIP_DUPLICATES, "POSSIBLE", "REVIEW"],
    [ImportStrategy.FILL_EMPTY_FIELDS, "EXACT", "FILL"],
    [ImportStrategy.FILL_EMPTY_FIELDS, "POSSIBLE", "REVIEW"],
    [ImportStrategy.REVIEW_ALL_MATCHES, "EXACT", "REVIEW"],
    [ImportStrategy.EXPLICIT_OVERWRITE, "EXACT", "REVIEW"],
  ] as const)("%s + %s → %s", (strategy, kind, expected) => {
    expect(dispositionFor(strategy, kind)).toBe(expected);
  });

  it("unique rows are always created; conflicts never auto-resolve", () => {
    for (const strategy of Object.values(ImportStrategy)) {
      expect(dispositionFor(strategy, "UNIQUE")).toBe("CREATE");
      expect(["SKIP", "REVIEW"]).toContain(dispositionFor(strategy, "CONFLICT"));
      expect(dispositionFor(strategy, "CONFLICT")).not.toBe("FILL");
    }
  });
});

describe("CSV output sanitization", () => {
  it("neutralizes formula-like cells", () => {
    expect(sanitizeCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(sanitizeCsvCell("+49 30")).toBe("'+49 30");
    expect(sanitizeCsvCell("@import")).toBe("'@import");
    expect(sanitizeCsvCell("normal")).toBe("normal");
  });
  it("escapes quotes and delimiters", () => {
    expect(buildCsv([['a"b', "c;d"]])).toBe('"a""b";"c;d"');
  });
});
