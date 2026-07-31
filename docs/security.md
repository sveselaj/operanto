# Security

## Permission matrix

Permissions are granted per organisation through the membership role
(`src/lib/rbac.ts`); the matrix below is the authority. A permission is
necessary, not sufficient — operators additionally pass record-level
assignment checks.

| Permission | ADMIN | SUPERVISOR | OPERATOR |
|---|---|---|---|
| org:manage | ✓ | — | — |
| members:manage | ✓ | — | — |
| integrations:manage | ✓ | — | — |
| customers:view_all | ✓ | ✓ | — |
| customers:view_assigned | ✓ | ✓ | ✓ (via own opportunities) |
| opportunities:view_all | ✓ | ✓ | — |
| opportunities:view_assigned | ✓ | ✓ | ✓ (assigned only) |
| opportunities:assign | ✓ | ✓ | — |
| opportunities:update_stage | ✓ | ✓ | ✓ (assigned only) |
| tasks:manage | ✓ | ✓ | ✓ (own/assigned) |
| notes:add | ✓ | ✓ | ✓ |
| activity:view_all | ✓ | ✓ | — (own opportunities) |
| audit:view | ✓ | — | — |

## Threat model (summary)

| Threat | Control |
|---|---|
| Forged webhook events | HMAC-SHA256 over `timestamp.rawBody`, timing-safe compare, secret stored AES-256-GCM-encrypted (`OPERANTO_ENCRYPTION_KEY`), never displayed; per-integration secrets |
| Replayed webhook requests | ±300 s timestamp window (timestamp is part of the signed message); duplicate `eventId` is a no-op (`unique (integrationId, eventId)`) |
| Event flooding | per-IP rate limit on ingestion, 256 KB body cap, async processing (the request does only verified storage) |
| Malicious payload contents | strict envelope validation before storage; handlers parse with Zod; no HTML rendering of payload fields without React's default escaping; roles/permissions are never read from events |
| Cross-tenant access via direct IDs | every query is organisation-scoped from a DB-verified membership; verified: foreign-org admin receives 404 on another org's opportunity |
| Privilege escalation via stale JWT | JWT carries only user id + issue time; role/status/permissions re-read from DB per request; `sessionsRevokedAt` invalidates all sessions instantly |
| Operator overreach | record-level filters (`assignedMembershipId`) composed into queries, not checked after fetch |
| Account takeover | invitation-only onboarding (no public registration), bcrypt cost 12, timing-equalized login, per-account + per-invite rate limits, 12+ char password policy, password change revokes all sessions |
| Invitation token leakage | 32 random bytes, only SHA-256 hash at rest, 7-day expiry, single-use (atomic claim), raw token never logged |
| Lockout / sabotage | final-admin protection: the last active ADMIN cannot be demoted or suspended; self-suspension blocked |
| Source system compromised | blast radius = that integration's org projections; staff events cannot touch Operanto access; disable the integration (single switch) and rotate the secret |
| Secrets in code/logs | secrets only via env; `.env*` gitignored (except `.env.example`); webhook secret encrypted at rest; invitation URLs logged only when no email provider is configured (dev) |
| Clickjacking / XSS / MIME | CSP (`frame-ancestors 'none'`, same-origin default), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS preload (next.config.ts) |
| CSRF | Auth.js CSRF on the credentials flow; server actions are same-origin-bound by Next.js; state-changing GETs don't exist |

## Known limitations (accepted for MVP, tracked)

- Rate limiting is per-instance in-memory unless `UPSTASH_REDIS_REST_URL` is
  configured; fine for single-instance deployments.
- No 2FA yet; mitigate with strong passwords + instant revocation.
- CSP allows `'unsafe-inline'` scripts (Next.js bootstrap); nonce-based CSP is
  a follow-up.
- Event processing runs in the web process (`after()` + cron retry) rather
  than a dedicated worker; extraction path documented in architecture.md.
