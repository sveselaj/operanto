/**
 * Growth feature flag — server-side only, environment-controlled, default
 * off. There is deliberately no request-derived input here: no header,
 * cookie, query or body value can enable Growth. Staging and production
 * remain off until the deployment explicitly sets the variable.
 */
export function growthEnabled(): boolean {
  return process.env.OPERANTO_GROWTH_ENABLED === "1";
}
