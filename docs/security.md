# Security


## Second-factor rotation

An active authenticator can be **replaced without ever turning 2FA off** —
the only path available to ADMIN/SUPERVISOR/AUDITOR, whose roles may not
disable it at all. Before this existed, a lost, shared or compromised
authenticator on a privileged account could only be fixed by editing the
database by hand.

Flow (Settings → Security → *Replace authenticator*):

1. Prove the **current** factor — a TOTP code or a recovery code (the
   documented path when the phone is gone). Rate-limited like every other
   second-factor check, fail-closed.
2. A candidate secret is issued into a **separate pending slot**; the active
   secret keeps working, so the account is never locked out or unprotected
   mid-rotation. Abandoning the flow changes nothing.
3. Confirm with a code from the **new** authenticator. Only then is the
   pending secret promoted, the replay counter reset, and a **fresh set of
   recovery codes** issued — the previous codes are invalidated, because a
   compromised enrolment's recovery codes are as dangerous as its secret.

Audited as `user.two_factor_rotated`. Covered by integration tests including
the mid-rotation old-secret-still-works case, old-secret-and-old-recovery-
codes-rejected after promotion, cancellation, and availability to the roles
that cannot disable 2FA.

**Operational note:** any account enrolled with a shared or fixture secret
(e.g. seeded with `SEED_TEST_TOTP_SECRET` for acceptance testing) should be
rotated to a private authenticator through this flow before real use.

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
| Account takeover | invitation-only onboarding (no public registration), bcrypt cost 12, timing-equalized login, per-account + per-IP rate limits, 12+ char password policy, password change revokes all sessions, **TOTP second factor mandatory for ADMIN and SUPERVISOR** |
| Stolen or observed TOTP code | the accepted counter is recorded, so a code cannot be replayed within its window; recovery codes are single-use and stored hashed |
| Personal data accumulating indefinitely | raw event payloads redacted after `OPERANTO_PAYLOAD_RETENTION_DAYS`; erasure and restriction of processing available per customer (docs/privacy.md) |
| Invitation token leakage | 32 random bytes, only SHA-256 hash at rest, 7-day expiry, single-use (atomic claim), raw token never logged |
| Lockout / sabotage | final-admin protection: the last active ADMIN cannot be demoted or suspended; self-suspension blocked |
| Source system compromised | blast radius = that integration's org projections; staff events cannot touch Operanto access; disable the integration (single switch) and rotate the secret |
| Secrets in code/logs | secrets only via env; `.env*` gitignored (except `.env.example`); webhook secret encrypted at rest; invitation URLs logged only when no email provider is configured (dev) |
| Clickjacking / XSS / MIME | CSP (`frame-ancestors 'none'`, same-origin default), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS preload (next.config.ts) |
| CSRF | Auth.js CSRF on the credentials flow; server actions are same-origin-bound by Next.js; state-changing GETs don't exist |

## Known limitations (accepted for MVP, tracked)

- Rate limiting is per-instance in-memory unless the Upstash REST pair
  (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) is configured —
  the only supported convention. When it IS configured but unreachable,
  authentication and invitation limits **fail closed** (deny) while event
  ingestion falls back to memory; see `docs/production-activation.md` for the
  per-limit table and rationale.
- Data-subject export (Art. 15/20) is manual; cross-system erasure requires
  running the procedure in both Pronatona and Operanto (docs/privacy.md).
- CSP allows `'unsafe-inline'` scripts (Next.js bootstrap); nonce-based CSP is
  a follow-up.
- Event processing runs in the web process (`after()` + cron retry) rather
  than a dedicated worker; extraction path documented in architecture.md.
