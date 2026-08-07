/**
 * Computer browser-bridge flag (C2) — server-side only, environment-
 * controlled, default OFF. Like the CRM flag: no request-derived input can
 * enable it — no header, cookie, query or body value. With the flag off,
 * grant creation refuses and every bridge endpoint 404s; the application
 * behaves identically to a build without the bridge.
 */
export function computerBridgeEnabled(): boolean {
  return process.env.OPERANTO_COMPUTER_BRIDGE_ENABLED === "1";
}

/**
 * Computer guide flag (C3) — page understanding + guide mode. Requires the
 * bridge too: understanding without an observation source is not a product
 * surface. Same rules as above: server-side, environment-only, default OFF.
 */
export function computerGuideEnabled(): boolean {
  return (
    process.env.OPERANTO_COMPUTER_GUIDE_ENABLED === "1" && computerBridgeEnabled()
  );
}
