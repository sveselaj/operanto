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

/**
 * LIVE-provider gate for Computer AI tasks (C3 hardening). Mock is always
 * the safe default; a live provider additionally requires BOTH an explicit
 * deployment opt-in and a pinned eval version that matches the code's
 * current COMPUTER_LIVE_EVAL_VERSION. A changed computer prompt bumps that
 * version, so live execution fails closed until the live injection-fixture
 * suite has been rerun and the pin updated. Generic (non-Computer) AI
 * behavior is unaffected.
 */
/**
 * Computer navigation flag (C4) — the first browser-side effect. Requires
 * the bridge (observation) and guide (understanding) flags too: execution
 * without a fresh observation and a recommendation is not a product
 * surface. Off by default; no existing organisation gains execution.
 */
export function computerNavigationEnabled(): boolean {
  return (
    process.env.OPERANTO_COMPUTER_NAVIGATION_ENABLED === "1" && computerGuideEnabled()
  );
}

export function computerLiveApproved(expectedEvalVersion: string): boolean {
  return (
    process.env.OPERANTO_COMPUTER_LIVE_ENABLED === "1" &&
    process.env.OPERANTO_COMPUTER_LIVE_EVAL_VERSION === expectedEvalVersion
  );
}
