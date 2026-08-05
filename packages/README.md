# CRM engine packages (`@operanto/crm-*`)

Imported in OI-3 from the CRIMSS repository (branch `oi-2-shared-engines`,
commit `03421f0`) where they were extracted in Phase OI-2 — see that repo's
`docs/OPERANTO_SHARED_SERVICES.md` (inventory + boundary rules),
`docs/OPERANTO_CANONICAL_DOMAIN_MODEL.md` (business language) and
`docs/OPERANTO_EVENT_MODEL.md` / `docs/OPERANTO_PERMISSION_MODEL.md`.

Rules (enforced by `test/package-boundaries.test.ts`):

- Pure business logic: no `next`/`react`/`server-only`, no `@/` app imports,
  no Prisma, no Node built-ins; npm deps allowlisted (`zod`,
  `libphonenumber-js`, `@date-fns/tz`).
- `src/index.ts` is the public API; engine-to-engine imports form a DAG.
- Unit tests live inside each package and run with `pnpm test`.

Sync discipline until the CRIMSS standalone deployment retires (OI-5/OI-10):
the CRIMSS repo remains the extraction source of record; fixes land there
first and are mirrored here commit-by-commit (both sides run identical
package test suites, so drift fails CI). The `crm-permissions` role matrix
maps CRIMSS roles and is NOT the authority in this deployment — the
`src/lib/rbac.ts` matrix is (one engine per deployment; one catalog document
governs both).
