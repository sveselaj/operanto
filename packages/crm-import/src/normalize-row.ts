import { TZDate } from "@date-fns/tz";
import { ConsentStatus } from "@operanto/crm-domain";
import { normalizeEmail, normalizePhone } from "@operanto/crm-phone";
import { IMPORT_LIMITS } from "./csv";
import type { ImportTargetField } from "./mapping";

/**
 * Deterministic row normalization + validation (pure, unit-tested).
 * Raw values are preserved in ImportRow.rawData/mappedData; this module
 * produces the normalized shape and the issue list that drives classification.
 * Nothing here silently corrects ambiguous data — ambiguity becomes an issue.
 */

export type IssueSeverity = "error" | "warning";

export interface RowIssue {
  field: string;
  code: string;
  severity: IssueSeverity;
}

export interface NormalizedRowData {
  externalReference?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  companyName?: string;
  phoneRaw?: string;
  normalizedPhone?: string;
  secondaryPhoneRaw?: string;
  normalizedSecondaryPhone?: string;
  emailRaw?: string;
  normalizedEmail?: string;
  source?: string;
  category?: string;
  platform?: string;
  estimatedValue?: number;
  currency?: string;
  campaignName?: string;
  assignedUserRef?: string;
  assignedTeamRef?: string;
  note?: string;
  consentStatus?: ConsentStatus;
  doNotCall?: boolean;
  dataOrigin?: string;
  createdAt?: string; // ISO — Json-safe
}

export interface NormalizeOptions {
  /** "de": 1.234,56 · "iso": 1234.56 */
  numberLocale: "de" | "iso";
  timezone: string;
  defaultCurrency: string;
  now: Date;
}

const SUPPORTED_CURRENCIES = new Set(["EUR", "USD", "CHF", "GBP"]);

/** Trim + collapse inner whitespace; Unicode preserved; no case changes. */
export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * German-locale amount parsing. de: dots are thousands separators when they
 * match the 3-digit grouping pattern, comma is the decimal separator.
 * Non-conforming patterns are invalid — never guessed.
 */
export function parseAmount(raw: string, locale: "de" | "iso"): number | null {
  const cleaned = raw.replace(/\s|€|EUR/gi, "").trim();
  if (cleaned === "") return null;
  if (locale === "de") {
    if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(cleaned) || /^-?\d+(,\d+)?$/.test(cleaned)) {
      return Number.parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
    }
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return Number.parseFloat(cleaned);
  return null;
}

/**
 * Accepted formats only: DD.MM.YYYY and YYYY-MM-DD, each optionally followed by
 * HH:mm(:ss). Interpreted in the organization timezone; impossible dates are
 * rejected (null).
 */
export function parseImportDate(raw: string, timezone: string): Date | null {
  const trimmed = raw.trim();
  let year: number, month: number, day: number;
  let time = "00:00:00";

  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}:\d{2}(?::\d{2})?))?$/.exec(trimmed);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}:\d{2}(?::\d{2})?))?$/.exec(trimmed);
  if (german) {
    day = Number(german[1]);
    month = Number(german[2]);
    year = Number(german[3]);
    if (german[4]) time = german[4];
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
    if (iso[4]) time = iso[4];
  } else {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  const [hh, mm, ss] = normalizedTime.split(":").map(Number);
  if (hh > 23 || mm > 59 || ss > 59) return null;
  // Component construction interprets the wall-clock values IN `timezone`.
  // (String construction would parse in the PROCESS timezone and only
  // re-frame the representation — a UTC server would shift every German
  // import date by one/two hours.)
  const candidate = new TZDate(year, month - 1, day, hh, mm, ss, timezone);
  if (Number.isNaN(candidate.getTime())) return null;
  // Reject silently rolled-over impossible dates (e.g. 31.02.).
  if (candidate.getMonth() + 1 !== month || candidate.getDate() !== day) return null;
  return new Date(candidate.getTime());
}

/** Explicit recognizable values only — anything else is unrecognized (null). */
export function parseBooleanFlag(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (["ja", "yes", "true", "1", "x"].includes(v)) return true;
  if (["nein", "no", "false", "0", ""].includes(v)) return false;
  return null;
}

export function parseConsentStatus(raw: string): ConsentStatus | null {
  const v = raw.trim().toUpperCase();
  if (v === "GIVEN" || v === "ERTEILT" || v === "JA" || v === "YES") return ConsentStatus.GIVEN;
  if (v === "REVOKED" || v === "WIDERRUFEN" || v === "NEIN" || v === "NO")
    return ConsentStatus.REVOKED;
  if (v === "UNKNOWN" || v === "UNBEKANNT") return ConsentStatus.UNKNOWN;
  return null;
}

export interface NormalizeResult {
  data: NormalizedRowData;
  issues: RowIssue[];
}

export function normalizeMappedRow(
  mapped: Partial<Record<ImportTargetField, string>>,
  options: NormalizeOptions
): NormalizeResult {
  const issues: RowIssue[] = [];
  const data: NormalizedRowData = {};

  const oversized = Object.entries(mapped).filter(
    ([, value]) => (value?.length ?? 0) > IMPORT_LIMITS.maxCellLength
  );
  for (const [field] of oversized) {
    issues.push({ field, code: "oversized", severity: "error" });
  }

  // Names — preserved, never title-cased.
  if (mapped.firstName) data.firstName = normalizeName(mapped.firstName);
  if (mapped.lastName) data.lastName = normalizeName(mapped.lastName);
  if (mapped.fullName) data.fullName = normalizeName(mapped.fullName);
  if (mapped.companyName) data.companyName = normalizeName(mapped.companyName);

  // fullName derivation / safe split (documented rule: only without explicit
  // first/last mapping, 2+ tokens, no comma — otherwise left unsplit).
  if (!data.fullName && (data.firstName || data.lastName)) {
    data.fullName = [data.firstName, data.lastName].filter(Boolean).join(" ");
  } else if (data.fullName && !data.firstName && !data.lastName) {
    if (!data.fullName.includes(",")) {
      const tokens = data.fullName.split(" ");
      if (tokens.length >= 2) {
        data.lastName = tokens[tokens.length - 1];
        data.firstName = tokens.slice(0, -1).join(" ");
      }
    }
  }

  // Phones — invalid ≠ missing; raw always preserved.
  if (mapped.phone) {
    data.phoneRaw = mapped.phone;
    const normalized = normalizePhone(mapped.phone);
    if (normalized) data.normalizedPhone = normalized;
    else issues.push({ field: "phone", code: "invalid_phone", severity: "warning" });
  }
  if (mapped.secondaryPhone) {
    data.secondaryPhoneRaw = mapped.secondaryPhone;
    const normalized = normalizePhone(mapped.secondaryPhone);
    if (normalized) data.normalizedSecondaryPhone = normalized;
    else
      issues.push({ field: "secondaryPhone", code: "invalid_phone", severity: "warning" });
  }

  // Email.
  if (mapped.email) {
    data.emailRaw = mapped.email;
    const normalized = normalizeEmail(mapped.email);
    if (normalized) data.normalizedEmail = normalized;
    else issues.push({ field: "email", code: "invalid_email", severity: "warning" });
  }

  // Provenance / plain strings.
  if (mapped.externalReference) data.externalReference = mapped.externalReference.trim();
  if (mapped.source) data.source = mapped.source.trim();
  if (mapped.category) data.category = mapped.category.trim();
  if (mapped.platform) data.platform = mapped.platform.trim();
  if (mapped.note) data.note = mapped.note.trim();
  if (mapped.dataOrigin) data.dataOrigin = mapped.dataOrigin.trim();
  if (mapped.campaign) data.campaignName = mapped.campaign.trim();
  if (mapped.assignedUser) data.assignedUserRef = mapped.assignedUser.trim();
  if (mapped.assignedTeam) data.assignedTeamRef = mapped.assignedTeam.trim();

  // Amount + currency.
  if (mapped.estimatedValue) {
    const amount = parseAmount(mapped.estimatedValue, options.numberLocale);
    if (amount === null || amount < 0 || amount > 999_999_999) {
      issues.push({ field: "estimatedValue", code: "invalid_amount", severity: "error" });
    } else {
      data.estimatedValue = amount;
    }
  }
  if (mapped.currency) {
    const currency = mapped.currency.trim().toUpperCase();
    if (SUPPORTED_CURRENCIES.has(currency)) data.currency = currency;
    else issues.push({ field: "currency", code: "unsupported_currency", severity: "error" });
  } else if (data.estimatedValue !== undefined) {
    data.currency = options.defaultCurrency;
    issues.push({ field: "currency", code: "currency_defaulted", severity: "warning" });
  }

  // Consent / do-not-call — explicit values only, never inferred.
  if (mapped.consentStatus) {
    const consent = parseConsentStatus(mapped.consentStatus);
    if (consent) data.consentStatus = consent;
    else issues.push({ field: "consentStatus", code: "unrecognized_value", severity: "warning" });
  }
  if (mapped.doNotCall) {
    const flag = parseBooleanFlag(mapped.doNotCall);
    if (flag !== null) data.doNotCall = flag;
    else issues.push({ field: "doNotCall", code: "unrecognized_value", severity: "warning" });
  }

  // Source-provided creation date — explicit mapping only, never future.
  if (mapped.createdAt) {
    const date = parseImportDate(mapped.createdAt, options.timezone);
    if (!date) {
      issues.push({ field: "createdAt", code: "invalid_date", severity: "error" });
    } else if (date.getTime() > options.now.getTime()) {
      issues.push({ field: "createdAt", code: "future_date", severity: "error" });
    } else {
      data.createdAt = date.toISOString();
    }
  }

  // Identity requirement: at least one usable contact identifier.
  const hasIdentity =
    data.normalizedPhone !== undefined ||
    data.normalizedSecondaryPhone !== undefined ||
    data.normalizedEmail !== undefined ||
    data.externalReference !== undefined;
  if (!hasIdentity) {
    issues.push({ field: "row", code: "no_contact_identity", severity: "error" });
  }

  // Display-name requirement (soft): warn when nothing names the record.
  if (!data.fullName && !data.companyName) {
    issues.push({ field: "row", code: "missing_name", severity: "warning" });
  }
  if (!data.source) {
    issues.push({ field: "source", code: "missing_source", severity: "warning" });
  }

  return { data, issues };
}

export type RowClassification = "VALID" | "VALID_WITH_WARNINGS" | "INVALID";

export function classifyRow(issues: RowIssue[]): RowClassification {
  if (issues.some((issue) => issue.severity === "error")) return "INVALID";
  if (issues.length > 0) return "VALID_WITH_WARNINGS";
  return "VALID";
}
