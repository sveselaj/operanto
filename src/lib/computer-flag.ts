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
