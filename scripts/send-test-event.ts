/**
 * Development utility: sign and send a synthetic Pronatona event to the local
 * ingestion endpoint, mimicking the Pronatona dispatcher exactly.
 *
 *   pnpm tsx scripts/send-test-event.ts [--replay <eventId>] [--bad-signature]
 *     [--expired] [--wrong-org] [--type <eventType>]
 */
import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const SECRET = process.env.PRONATONA_WEBHOOK_SECRET;
const SOURCE_ORG = process.env.PRONATONA_SOURCE_ORGANISATION_ID ?? "org_pronatona_local_test";

if (!SECRET) {
  console.error("PRONATONA_WEBHOOK_SECRET is not set");
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const eventId = opt("--replay") ?? `evt_${randomUUID()}`;
const eventType = opt("--type") ?? "lead.created";
const leadId = opt("--lead") ?? `lead_${randomUUID().slice(0, 8)}`;

const envelope = {
  eventId,
  eventType,
  schemaVersion: 1,
  occurredAt: new Date().toISOString(),
  source: "PRONATONA_WEB",
  organisationId: flag("--wrong-org") ? "org_someone_else" : SOURCE_ORG,
  correlationId: leadId,
  actor: { type: "CUSTOMER", userId: null, membershipId: null },
  data: {
    leadId,
    inquiryType: "PROPERTY_QUESTION",
    sourceChannel: "website",
    customer: {
      name: "Arlinda Berisha",
      email: "arlinda.berisha@example.com",
      phone: "+38344123456",
      preferredLanguage: "sq",
      preferredChannel: "WHATSAPP",
    },
    message:
      "Përshëndetje, a është ende në shitje banesa PRN-A1B2C3? A mund të organizojmë një vizitë këtë javë?",
    propertyId: "prop_local_1",
    propertyReference: "PRN-A1B2C3",
    assignedAgentId: null,
    property: {
      id: "prop_local_1",
      referenceCode: "PRN-A1B2C3",
      title: "Banesë 3+1 në Qendër, Prishtinë",
      status: "ACTIVE",
      price: 185000,
      currency: "EUR",
      city: "Prishtinë",
      publicUrl: "https://pronatona.com/sq/prona/banese-3-1-ne-qender",
      thumbnailUrl: null,
    },
  },
};

const rawBody = JSON.stringify(envelope);
const timestamp = flag("--expired")
  ? String(Math.floor(Date.now() / 1000) - 3600)
  : String(Math.floor(Date.now() / 1000));
const signature = createHmac("sha256", SECRET)
  .update(`${timestamp}.${rawBody}`)
  .digest("hex");

async function main() {
  const res = await fetch(`${BASE_URL}/api/v1/integrations/pronatona/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Operanto-Event-Id": eventId,
      "X-Operanto-Timestamp": timestamp,
      "X-Operanto-Signature": flag("--bad-signature")
        ? "0".repeat(signature.length)
        : signature,
    },
    body: rawBody,
  });
  const body = await res.text();
  console.log(`HTTP ${res.status} — ${body}`);
  console.log(`eventId: ${eventId}`);
  console.log(`leadId:  ${leadId}`);
}

main();
