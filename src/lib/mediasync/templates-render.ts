/**
 * MediaSync — message template rendering (pure).
 *
 * Templates use `{{name}}` placeholders. These helpers extract the declared
 * variables and render a template against a set of values, reporting any
 * placeholders left unfilled so callers can block sending an incomplete message.
 */

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Unique variable names referenced by a template body, in first-seen order. */
export function extractTemplateVariables(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(VAR_RE)) seen.add(m[1]);
  return [...seen];
}

export type RenderResult = { text: string; missing: string[] };

/**
 * Substitute `{{var}}` placeholders. Missing/empty values are left as the raw
 * placeholder and reported in `missing` (never silently blanked).
 */
export function renderTemplate(
  body: string,
  vars: Record<string, string | number | null | undefined>,
): RenderResult {
  const missing = new Set<string>();
  const text = body.replace(VAR_RE, (_full, name: string) => {
    const v = vars[name];
    if (v === undefined || v === null || v === "") {
      missing.add(name);
      return `{{${name}}}`;
    }
    return String(v);
  });
  return { text, missing: [...missing] };
}
