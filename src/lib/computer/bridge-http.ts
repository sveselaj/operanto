/**
 * Shared HTTP plumbing for the C2 bridge routes. Bearer-token only — the
 * bridge endpoints accept no cookies and no session identity, so there is
 * no CSRF surface and no way for a browser page to ride an operator's
 * cockpit session into the ingestion API.
 */

export const BRIDGE_MAX_BODY_BYTES = 512 * 1024;

export function bridgeToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  const match = header?.match(/^Bearer\s+([A-Za-z0-9_-]{16,128})$/);
  return match ? match[1] : null;
}
