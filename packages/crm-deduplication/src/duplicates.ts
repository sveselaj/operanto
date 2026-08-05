/**
 * Structural input contract: the identifier fields the ladder reads. Any
 * normalized row shape (e.g. crm-import's NormalizedRowData) satisfies it —
 * declared here so the dependency points import → deduplication, never back.
 */
export interface DuplicateCheckRow {
  fullName?: string;
  companyName?: string;
  normalizedPhone?: string;
  normalizedSecondaryPhone?: string;
  normalizedEmail?: string;
  source?: string;
  externalReference?: string;
}

/**
 * Deterministic duplicate ladder (pure, unit-tested; docs/PHASE3_DESIGN.md §7).
 * Lookups are built from ONE organization's leads only — cross-tenant matching
 * is structurally impossible.
 *
 * Exact order: phone → email → source+externalReference. Identifiers agreeing
 * on one lead stay EXACT (all reasons recorded); identifiers pointing at
 * DIFFERENT leads are a CONFLICT and never auto-resolved.
 */

export interface LeadSnapshot {
  id: string;
  fullName: string;
  companyName: string | null;
  normalizedPhone: string | null;
  normalizedSecondaryPhone: string | null;
  normalizedEmail: string | null;
  source: string | null;
  externalReference: string | null;
  /** Rows matching a do-not-contact lead are BLOCKED from import work. */
  doNotCall: boolean;
}

export interface DuplicateLookup {
  byPhone: Map<string, string[]>;
  byEmail: Map<string, string[]>;
  byRef: Map<string, string[]>;
  byCompany: Map<string, string[]>;
  byId: Map<string, LeadSnapshot>;
}

function push(map: Map<string, string[]>, key: string, id: string): void {
  const list = map.get(key);
  if (list) {
    if (!list.includes(id)) list.push(id);
  } else {
    map.set(key, [id]);
  }
}

export function refKey(source: string, externalReference: string): string {
  return `${source.toLowerCase()}::${externalReference.toLowerCase()}`;
}

function companyKey(company: string): string {
  return company.toLowerCase().replace(/\s+/g, " ").trim();
}

export function buildDuplicateLookup(leads: LeadSnapshot[]): DuplicateLookup {
  const lookup: DuplicateLookup = {
    byPhone: new Map(),
    byEmail: new Map(),
    byRef: new Map(),
    byCompany: new Map(),
    byId: new Map(),
  };
  for (const lead of leads) {
    lookup.byId.set(lead.id, lead);
    if (lead.normalizedPhone) push(lookup.byPhone, lead.normalizedPhone, lead.id);
    if (lead.normalizedSecondaryPhone)
      push(lookup.byPhone, lead.normalizedSecondaryPhone, lead.id);
    if (lead.normalizedEmail) push(lookup.byEmail, lead.normalizedEmail, lead.id);
    if (lead.source && lead.externalReference)
      push(lookup.byRef, refKey(lead.source, lead.externalReference), lead.id);
    if (lead.companyName) push(lookup.byCompany, companyKey(lead.companyName), lead.id);
  }
  return lookup;
}

export type DuplicateReason =
  | "phone_match"
  | "email_match"
  | "reference_match"
  | "file_duplicate"
  | "company_and_similar_name"
  | "name_and_email_domain";

export type DuplicateResult =
  | { kind: "UNIQUE" }
  | { kind: "FILE_DUPLICATE"; reasons: DuplicateReason[] }
  | { kind: "EXACT"; leadId: string; reasons: DuplicateReason[] }
  | { kind: "CONFLICT"; leadIds: string[]; reasons: DuplicateReason[] }
  | { kind: "POSSIBLE"; leadId: string; reasons: DuplicateReason[]; confidence: number };

/** Identifiers already seen earlier in the same file. */
export interface SeenInFile {
  phones: Set<string>;
  emails: Set<string>;
  refs: Set<string>;
}

export function createSeenInFile(): SeenInFile {
  return { phones: new Set(), emails: new Set(), refs: new Set() };
}

/** Case-folded Levenshtein distance, capped for early exit. */
export function levenshtein(a: string, b: string, cap = 3): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (Math.abs(s.length - t.length) > cap) return cap + 1;
  const prev = new Array<number>(t.length + 1);
  const curr = new Array<number>(t.length + 1);
  for (let j = 0; j <= t.length; j++) prev[j] = j;
  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= t.length; j++) prev[j] = curr[j];
  }
  return prev[t.length];
}

/** Documented similarity for review candidates: distance ≤ 2 or token subset. */
export function namesSimilar(a: string, b: string): boolean {
  if (levenshtein(a, b, 2) <= 2) return true;
  const tokensA = new Set(a.toLowerCase().split(/\s+/));
  const tokensB = new Set(b.toLowerCase().split(/\s+/));
  const [small, large] =
    tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  return small.size > 0 && [...small].every((token) => large.has(token));
}

export function classifyDuplicate(
  row: DuplicateCheckRow,
  lookup: DuplicateLookup,
  seen: SeenInFile
): DuplicateResult {
  const reasonsByLead = new Map<string, DuplicateReason[]>();
  const fileReasons: DuplicateReason[] = [];

  const addMatches = (ids: string[] | undefined, reason: DuplicateReason) => {
    for (const id of ids ?? []) {
      const list = reasonsByLead.get(id);
      if (list) {
        if (!list.includes(reason)) list.push(reason);
      } else {
        reasonsByLead.set(id, [reason]);
      }
    }
  };

  // Exact ladder, in documented order.
  for (const phone of [row.normalizedPhone, row.normalizedSecondaryPhone]) {
    if (!phone) continue;
    if (seen.phones.has(phone)) fileReasons.push("phone_match");
    addMatches(lookup.byPhone.get(phone), "phone_match");
  }
  if (row.normalizedEmail) {
    if (seen.emails.has(row.normalizedEmail)) fileReasons.push("email_match");
    addMatches(lookup.byEmail.get(row.normalizedEmail), "email_match");
  }
  if (row.source && row.externalReference) {
    const key = refKey(row.source, row.externalReference);
    if (seen.refs.has(key)) fileReasons.push("reference_match");
    addMatches(lookup.byRef.get(key), "reference_match");
  }

  if (reasonsByLead.size > 1) {
    return {
      kind: "CONFLICT",
      leadIds: [...reasonsByLead.keys()].sort(),
      reasons: [...new Set([...reasonsByLead.values()].flat())],
    };
  }
  if (reasonsByLead.size === 1) {
    const [leadId, reasons] = [...reasonsByLead.entries()][0];
    return { kind: "EXACT", leadId, reasons };
  }
  if (fileReasons.length > 0) {
    const reasons: DuplicateReason[] = [...new Set<DuplicateReason>([...fileReasons, "file_duplicate"])];
    return { kind: "FILE_DUPLICATE", reasons };
  }

  // Possible duplicates (review candidates only).
  if (row.companyName && row.fullName) {
    const candidates = lookup.byCompany.get(companyKey(row.companyName)) ?? [];
    for (const id of candidates) {
      const lead = lookup.byId.get(id);
      if (lead && namesSimilar(lead.fullName, row.fullName)) {
        return {
          kind: "POSSIBLE",
          leadId: id,
          reasons: ["company_and_similar_name"],
          confidence: 0.7,
        };
      }
    }
  }
  if (row.fullName && row.normalizedEmail) {
    const domain = row.normalizedEmail.split("@")[1];
    for (const [email, ids] of lookup.byEmail) {
      if (!email.endsWith(`@${domain}`)) continue;
      for (const id of ids) {
        const lead = lookup.byId.get(id);
        if (lead && lead.fullName.toLowerCase() === row.fullName.toLowerCase()) {
          return {
            kind: "POSSIBLE",
            leadId: id,
            reasons: ["name_and_email_domain"],
            confidence: 0.6,
          };
        }
      }
    }
  }

  return { kind: "UNIQUE" };
}

/** Records this row's identifiers for in-file dedup of subsequent rows. */
export function rememberRow(row: DuplicateCheckRow, seen: SeenInFile): void {
  if (row.normalizedPhone) seen.phones.add(row.normalizedPhone);
  if (row.normalizedSecondaryPhone) seen.phones.add(row.normalizedSecondaryPhone);
  if (row.normalizedEmail) seen.emails.add(row.normalizedEmail);
  if (row.source && row.externalReference)
    seen.refs.add(refKey(row.source, row.externalReference));
}
