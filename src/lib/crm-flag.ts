/**
 * CRM module flag (OI-3) — server-side only, environment-controlled, default
 * off. There is deliberately no request-derived input here: no header,
 * cookie, query or body value can enable the CRM. Staging and production
 * remain off until the deployment explicitly sets the variable.
 */
export function crmEnabled(): boolean {
  return process.env.OPERANTO_CRM_ENABLED === "1";
}
