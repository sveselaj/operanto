-- Remove acceptance-test fixtures and probe data from a STAGING database.
--
-- Preserves: the real staging organisation, its administrator, integration
-- configuration (including the encrypted webhook secret), migration history,
-- and the AuditEvent table structure. Audit rows for staff actions are kept —
-- an audit trail that can be trimmed is not an audit trail; only the rows that
-- reference deleted test events are removed, and only because their targets no
-- longer exist.
--
-- NEVER run against production. Take a backup first (see
-- docs/operations-runbook.md). Run inside a transaction and review the counts
-- printed at the end before COMMIT.
--
--   psql "$DATABASE_URL" -f scripts/clean-staging-fixtures.sql
--
BEGIN;

-- Fixture organisation created only for cross-tenant isolation testing.
-- Cascades to its memberships, and nothing else references it.
DELETE FROM "Organisation" WHERE slug = 'isolation-test';

-- Fixture users (their memberships cascade). The real administrator, matched
-- by SEED_ADMIN_EMAIL, is deliberately NOT in this list.
DELETE FROM "User"
WHERE email IN ('operator@operanto.local', 'admin@isolation-test.local');

-- Probe/acceptance data. Every generator prefixes its rows so they can be
-- identified precisely rather than by date ranges.
--   E2E Customer *   — acceptance suite
--   Rotation Probe * — secret-rotation suite
--   Staging Probe *  — verify-staging.sh ingestion matrix
--   Arlinda/Blerim   — first-milestone manual verification
--
-- Order matters: Opportunity → Customer is ON DELETE RESTRICT, so the
-- opportunities must go before the customers they belong to. Activities,
-- tasks and opportunity/property links cascade from those deletes.
CREATE TEMP TABLE fixture_customers ON COMMIT DROP AS
SELECT id FROM "Customer"
WHERE name LIKE 'E2E Customer %'
   OR name LIKE 'Rotation Probe %'
   OR name LIKE 'Staging Probe %'
   OR email LIKE 'e2e.%@example.com'
   OR email LIKE 'rot.%@example.com'
   OR email LIKE 'probe.%@example.com'
   OR email IN ('arlinda.berisha@example.com', 'blerim.gashi@example.com');

DELETE FROM "Opportunity"
WHERE "customerId" IN (SELECT id FROM fixture_customers)
   OR "sourceOpportunityId" LIKE 'lead_e2e_%'
   OR "sourceOpportunityId" LIKE 'lead_rot_%'
   OR "sourceOpportunityId" LIKE 'lead_evt_stg_%'
   OR "sourceOpportunityId" LIKE 'lead_missing_%';

DELETE FROM "Customer" WHERE id IN (SELECT id FROM fixture_customers);

-- Property contexts invented by the test generators.
DELETE FROM "PropertyContext"
WHERE "referenceCode" LIKE 'PRN-E2E-%'
   OR "referenceCode" LIKE 'PRN-STG-%'
   OR "sourcePropertyId" LIKE 'prop_lead_%'
   OR "sourcePropertyId" LIKE 'prop_local_%';

-- Ingestion rows produced by the suites and the verification harness.
DELETE FROM "InboundEvent"
WHERE "eventId" LIKE 'evt_stg_%'
   OR "eventId" LIKE 'evt_dl_%'
   OR "eventId" LIKE 'evt_bad_%'
   OR "eventId" LIKE 'evt_old_%'
   OR "eventId" LIKE 'evt_org_%'
   OR "eventId" LIKE 'evt_big_%'
   OR "rawPayload"->'data'->>'leadId' LIKE 'lead_e2e_%'
   OR "rawPayload"->'data'->>'leadId' LIKE 'lead_rot_%'
   OR "rawPayload"->'data'->>'leadId' LIKE 'lead_missing_%';

-- Identity mappings that pointed at the deleted test entities.
DELETE FROM "ExternalIdentityMapping" m
WHERE (m."operantoEntityType" = 'opportunity'
       AND NOT EXISTS (SELECT 1 FROM "Opportunity" o WHERE o.id = m."operantoEntityId"))
   OR (m."operantoEntityType" = 'property_context'
       AND NOT EXISTS (SELECT 1 FROM "PropertyContext" p WHERE p.id = m."operantoEntityId"))
   OR (m."operantoEntityType" = 'membership'
       AND NOT EXISTS (SELECT 1 FROM "Membership" ms WHERE ms.id = m."operantoEntityId"));

-- Audit rows whose target no longer exists (integration events for deleted
-- InboundEvent rows). Staff-action audit history is untouched.
DELETE FROM "AuditEvent" a
WHERE a."targetType" = 'InboundEvent'
  AND a."targetId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "InboundEvent" e WHERE e.id = a."targetId");

-- Orphaned activities (their customer/opportunity was removed) are handled by
-- ON DELETE CASCADE; anything left references surviving records.

SELECT 'Organisation' AS table, count(*) FROM "Organisation"
UNION ALL SELECT 'User', count(*) FROM "User"
UNION ALL SELECT 'Membership', count(*) FROM "Membership"
UNION ALL SELECT 'Integration', count(*) FROM "Integration"
UNION ALL SELECT 'InboundEvent', count(*) FROM "InboundEvent"
UNION ALL SELECT 'Customer', count(*) FROM "Customer"
UNION ALL SELECT 'Opportunity', count(*) FROM "Opportunity"
UNION ALL SELECT 'PropertyContext', count(*) FROM "PropertyContext"
UNION ALL SELECT 'OpportunityProperty', count(*) FROM "OpportunityProperty"
UNION ALL SELECT 'Activity', count(*) FROM "Activity"
UNION ALL SELECT 'Task', count(*) FROM "Task"
UNION ALL SELECT 'AuditEvent', count(*) FROM "AuditEvent"
UNION ALL SELECT 'ExternalIdentityMapping', count(*) FROM "ExternalIdentityMapping"
ORDER BY 1;

COMMIT;
