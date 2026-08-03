import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyMapping,
  checksumOf,
  guessMapping,
  neutralizeFormula,
  parseCsv,
  validateMappedRow,
} from "@/lib/services/growth/csv";
import { growthEnabled } from "@/lib/growth-flag";

describe("csv parsing", () => {
  it("parses comma CSV with quoted fields and escaped quotes", () => {
    const parsed = parseCsv(
      'name,city\n"Fenster ""Nord"" GmbH","Hamburg, DE"\nRenovex,Köln\n',
    );
    expect(parsed.delimiter).toBe(",");
    expect(parsed.headers).toEqual(["name", "city"]);
    expect(parsed.rows).toEqual([
      ['Fenster "Nord" GmbH', "Hamburg, DE"],
      ["Renovex", "Köln"],
    ]);
  });

  it("detects semicolon delimiters from the header line", () => {
    const parsed = parseCsv("name;stadt\nAlpenglas;München\n");
    expect(parsed.delimiter).toBe(";");
    expect(parsed.rows[0]).toEqual(["Alpenglas", "München"]);
  });

  it("strips the BOM, skips blank lines, handles CRLF", () => {
    const parsed = parseCsv("﻿name,city\r\nA,B\r\n\r\nC,D\r\n");
    expect(parsed.headers).toEqual(["name", "city"]);
    expect(parsed.rows).toHaveLength(2);
  });

  it("rejects null bytes, duplicate headers, unterminated quotes, empty files", () => {
    expect(() => parseCsv("name\x00,city\nA,B")).toThrow(/null bytes/);
    expect(() => parseCsv("name,Name\nA,B")).toThrow(/Duplicate column/);
    expect(() => parseCsv('name,city\n"open,B')).toThrow(/Unterminated/);
    expect(() => parseCsv("   ")).toThrow(/empty/);
    expect(() => parseCsv("only-header,row")).toThrow(/header row and at least one/);
  });

  it("enforces row and column limits", () => {
    const wide = Array.from({ length: 61 }, (_, i) => `c${i}`).join(",");
    expect(() => parseCsv(`${wide}\n${wide}`)).toThrow(/columns/);
    const tall = "name\n" + Array.from({ length: 2001 }, (_, i) => `row${i}`).join("\n");
    expect(() => parseCsv(tall)).toThrow(/rows/);
  });
});

describe("formula-injection neutralization", () => {
  it("prefixes dangerous leading characters and leaves normal values alone", () => {
    expect(neutralizeFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(neutralizeFormula("+49 30 123")).toBe("'+49 30 123");
    expect(neutralizeFormula("-2")).toBe("'-2");
    expect(neutralizeFormula("@import")).toBe("'@import");
    expect(neutralizeFormula("Fenster GmbH")).toBe("Fenster GmbH");
  });
});

describe("mapping and validation", () => {
  it("guesses German and English headers, never double-assigns a field", () => {
    const mapping = guessMapping(["Firma", "Webseite", "Stadt", "E-Mail", "Notizen"]);
    expect(mapping["Firma"]).toBe("name");
    expect(mapping["Webseite"]).toBe("website");
    expect(mapping["Stadt"]).toBe("city");
    expect(mapping["E-Mail"]).toBe("publicEmail");
    expect(mapping["Notizen"]).toBe("ignore");
    const doubled = guessMapping(["name", "company"]);
    expect(Object.values(doubled).filter((f) => f === "name")).toHaveLength(1);
  });

  it("applies mapping by header and validates rows", () => {
    const parsed = parseCsv("Firma,Mitarbeiter,land\nA GmbH,25,de\n,abc,Deutschland\n");
    const rows = applyMapping(parsed, {
      Firma: "name",
      Mitarbeiter: "employeeEstimate",
      land: "country",
    });
    expect(rows[0]).toMatchObject({ name: "A GmbH", employeeEstimate: "25", country: "de" });
    expect(validateMappedRow(rows[0]!)).toEqual([]);
    expect(validateMappedRow(rows[1]!)).toEqual(
      expect.arrayContaining(["missing_name", "invalid_employee_estimate", "invalid_country_code"]),
    );
  });

  it("checksums are stable and content-sensitive", () => {
    expect(checksumOf("a,b\n1,2")).toBe(checksumOf("a,b\n1,2"));
    expect(checksumOf("a,b\n1,2")).not.toBe(checksumOf("a,b\n1,3"));
  });
});

describe("growth feature flag", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is off by default, on only with the exact value, never request-derived", () => {
    vi.stubEnv("OPERANTO_GROWTH_ENABLED", "");
    expect(growthEnabled()).toBe(false);
    vi.stubEnv("OPERANTO_GROWTH_ENABLED", "true");
    expect(growthEnabled()).toBe(false);
    vi.stubEnv("OPERANTO_GROWTH_ENABLED", "1");
    expect(growthEnabled()).toBe(true);
  });
});
