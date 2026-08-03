import { describe, expect, it } from "vitest";
import {
  normalizeCompanyName,
  normalizeDomain,
  normalizeUrl,
} from "@/lib/services/growth/normalize";

describe("growth normalisation", () => {
  it("normalizes domains to a lower-cased registrable host", () => {
    expect(normalizeDomain("https://www.Fenster-Nord.example/kontakt?x=1")).toBe(
      "fenster-nord.example",
    );
    expect(normalizeDomain("WWW.EXAMPLE.DE")).toBe("example.de");
    expect(normalizeDomain("example.de:8080")).toBe("example.de");
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });

  it("normalizes company names across legal forms and punctuation", () => {
    expect(normalizeCompanyName("Fenster Nordlicht GmbH")).toBe(
      normalizeCompanyName("FENSTER-NORDLICHT gmbh"),
    );
    expect(normalizeCompanyName("Alpenglas Montagen GmbH & Co. KG")).toBe(
      "alpenglas montagen",
    );
    expect(normalizeCompanyName("Renovex Süd AG")).toBe("renovex süd");
  });

  it("normalizes URLs and rejects garbage", () => {
    expect(normalizeUrl("fenster.example/pfad")).toBe("https://fenster.example/pfad");
    expect(normalizeUrl("https://a.example")).toBe("https://a.example/");
    expect(normalizeUrl("ht!tp://???")).toBeNull();
  });
});
