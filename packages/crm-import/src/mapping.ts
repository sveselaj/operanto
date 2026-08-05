/**
 * Column-mapping definitions and header auto-suggestions (pure, unit-tested).
 * Suggestions are never committed without user review — the mapping screen
 * always shows and requires confirmation.
 */

export const IMPORT_TARGET_FIELDS = [
  "externalReference",
  "firstName",
  "lastName",
  "fullName",
  "companyName",
  "phone",
  "secondaryPhone",
  "email",
  "source",
  "category",
  "platform",
  "estimatedValue",
  "currency",
  "campaign",
  "assignedUser",
  "assignedTeam",
  "note",
  "consentStatus",
  "doNotCall",
  "dataOrigin",
  "createdAt",
] as const;

export type ImportTargetField = (typeof IMPORT_TARGET_FIELDS)[number];

/** Mapping: one entry per source column; null = ignore the column. */
export type ColumnMapping = (ImportTargetField | null)[];

function fold(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

const HEADER_SYNONYMS: Record<string, ImportTargetField> = {
  // identity
  name: "fullName",
  vollstaendigername: "fullName",
  fullname: "fullName",
  kontakt: "fullName",
  vorname: "firstName",
  firstname: "firstName",
  nachname: "lastName",
  lastname: "lastName",
  familienname: "lastName",
  firma: "companyName",
  unternehmen: "companyName",
  company: "companyName",
  firmenname: "companyName",
  // contact
  telefon: "phone",
  telefonnummer: "phone",
  phone: "phone",
  rufnummer: "phone",
  mobil: "secondaryPhone",
  handy: "secondaryPhone",
  mobile: "secondaryPhone",
  telefon2: "secondaryPhone",
  email: "email",
  emailadresse: "email",
  mail: "email",
  // provenance
  quelle: "source",
  source: "source",
  plattform: "platform",
  platform: "platform",
  kampagne: "campaign",
  campaign: "campaign",
  kategorie: "category",
  category: "category",
  referenz: "externalReference",
  externereferenz: "externalReference",
  reference: "externalReference",
  id: "externalReference",
  // value
  betrag: "estimatedValue",
  umsatz: "estimatedValue",
  wert: "estimatedValue",
  amount: "estimatedValue",
  waehrung: "currency",
  currency: "currency",
  // assignment
  bearbeiter: "assignedUser",
  mitarbeiter: "assignedUser",
  agent: "assignedUser",
  team: "assignedTeam",
  // misc
  notiz: "note",
  bemerkung: "note",
  kommentar: "note",
  note: "note",
  einwilligung: "consentStatus",
  consent: "consentStatus",
  werbesperre: "doNotCall",
  anrufsperre: "doNotCall",
  donotcall: "doNotCall",
  herkunft: "dataOrigin",
  datenherkunft: "dataOrigin",
  erstellt: "createdAt",
  erstelltam: "createdAt",
  datum: "createdAt",
  createdat: "createdAt",
};

/** Suggests a mapping from header names. Duplicate suggestions keep the first. */
export function suggestMapping(headers: string[]): ColumnMapping {
  const used = new Set<ImportTargetField>();
  return headers.map((header) => {
    const target = HEADER_SYNONYMS[fold(header)];
    if (!target || used.has(target)) return null;
    used.add(target);
    return target;
  });
}

export type MappingError = "duplicateTarget" | "noIdentityField" | "columnCountMismatch";

/** Fields of which at least one must be mapped for rows to be workable. */
const IDENTITY_FIELDS: ImportTargetField[] = [
  "phone",
  "email",
  "externalReference",
  "fullName",
  "lastName",
];

export function validateMapping(
  mapping: ColumnMapping,
  columnCount: number
): MappingError[] {
  const errors: MappingError[] = [];
  if (mapping.length !== columnCount) errors.push("columnCountMismatch");

  const seen = new Set<ImportTargetField>();
  for (const target of mapping) {
    if (target === null) continue;
    if (seen.has(target)) {
      errors.push("duplicateTarget");
      break;
    }
    seen.add(target);
  }

  if (!IDENTITY_FIELDS.some((field) => seen.has(field))) {
    errors.push("noIdentityField");
  }
  return errors;
}

/** Applies a mapping to one raw record, trimming cells; empty cells drop out. */
export function applyMapping(
  record: string[],
  mapping: ColumnMapping
): Partial<Record<ImportTargetField, string>> {
  const result: Partial<Record<ImportTargetField, string>> = {};
  mapping.forEach((target, index) => {
    if (!target) return;
    const value = (record[index] ?? "").trim();
    if (value !== "") result[target] = value;
  });
  return result;
}
