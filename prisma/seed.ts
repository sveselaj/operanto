/**
 * Operanto seed — environment bootstrap, NOT demo data.
 *
 * Idempotent: upserts the Pronatona organisation, the initial administrator
 * (credentials from SEED_ADMIN_*), and the Pronatona integration with the
 * webhook secret from PRONATONA_WEBHOOK_SECRET encrypted at rest. Never wipes
 * existing data. Optional: SEED_SECOND_ORG=1 adds a second organisation for
 * cross-tenant isolation testing (development only).
 */
import "dotenv/config";
import {
  createCipheriv,
  randomBytes,
} from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Duplicated from src/lib/crypto.ts (the app module imports `server-only`,
// which cannot be loaded from a plain script).
function encryptSecret(plaintext: string): string {
  const hex = process.env.OPERANTO_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("OPERANTO_ENCRYPTION_KEY must be a 32-byte hex string");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(hex, "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

async function upsertOrgWithAdmin(input: {
  name: string;
  slug: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
}) {
  const organisation = await prisma.organisation.upsert({
    where: { slug: input.slug },
    create: { name: input.name, slug: input.slug, vertical: "real_estate" },
    update: {},
  });

  const passwordHash = await bcrypt.hash(input.adminPassword, 12);
  const admin = await prisma.user.upsert({
    where: { email: input.adminEmail.toLowerCase() },
    create: {
      email: input.adminEmail.toLowerCase(),
      name: input.adminName,
      passwordHash,
      status: "ACTIVE",
      passwordUpdatedAt: new Date(),
    },
    update: {},
  });

  await prisma.membership.upsert({
    where: {
      organisationId_userId: { organisationId: organisation.id, userId: admin.id },
    },
    create: {
      organisationId: organisation.id,
      userId: admin.id,
      role: "ADMIN",
      status: "ACTIVE",
    },
    update: { role: "ADMIN", status: "ACTIVE" },
  });

  return { organisation, admin };
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminName = process.env.SEED_ADMIN_NAME ?? "Operanto Admin";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const webhookSecret = process.env.PRONATONA_WEBHOOK_SECRET;

  if (!adminEmail || !adminPassword) {
    throw new Error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required");
  }
  if (adminPassword.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters");
  }
  if (!webhookSecret || webhookSecret.length < 32) {
    throw new Error("PRONATONA_WEBHOOK_SECRET must be at least 32 characters");
  }

  const { organisation } = await upsertOrgWithAdmin({
    name: "Pronatona",
    slug: "pronatona",
    adminEmail,
    adminName,
    adminPassword,
  });

  const sourceOrganisationId =
    process.env.PRONATONA_SOURCE_ORGANISATION_ID || "pronatona-org-unmapped";

  const existing = await prisma.integration.findUnique({
    where: {
      type_sourceOrganisationId: {
        type: "PRONATONA",
        sourceOrganisationId,
      },
    },
  });
  if (existing) {
    console.log(`Integration already present (${existing.id}) — secret unchanged.`);
  } else {
    const integration = await prisma.integration.create({
      data: {
        organisationId: organisation.id,
        type: "PRONATONA",
        sourceSystem: "PRONATONA_WEB",
        sourceOrganisationId,
        status: "ACTIVE",
        webhookSecretEncrypted: encryptSecret(webhookSecret),
      },
    });
    console.log(`Integration created: ${integration.id}`);
  }

  if (process.env.SEED_SECOND_ORG === "1" || process.env.SEED_TEST_USERS === "1") {
    await upsertOrgWithAdmin({
      name: "Isolation Test Org",
      slug: "isolation-test",
      adminEmail: "admin@isolation-test.local",
      adminName: "Isolation Admin",
      adminPassword: "isolation-test-Admin1-long",
    });
    console.log("Second organisation seeded (isolation-test).");
  }

  // Acceptance-test fixtures (Playwright). Never enable in production:
  // fixed credentials, meant for local/staging verification runs only.
  if (process.env.SEED_TEST_USERS === "1") {
    const operatorHash = await bcrypt.hash("operator-test-Passw0rd1", 12);
    const operator = await prisma.user.upsert({
      where: { email: "operator@operanto.local" },
      create: {
        email: "operator@operanto.local",
        name: "Test Operator",
        passwordHash: operatorHash,
        status: "ACTIVE",
        passwordUpdatedAt: new Date(),
      },
      update: {},
    });
    await prisma.membership.upsert({
      where: {
        organisationId_userId: {
          organisationId: organisation.id,
          userId: operator.id,
        },
      },
      create: {
        organisationId: organisation.id,
        userId: operator.id,
        role: "OPERATOR",
        status: "ACTIVE",
      },
      update: { role: "OPERATOR", status: "ACTIVE" },
    });
    console.log("Test operator seeded (operator@operanto.local).");
  }

  console.log(`Seed complete. Organisation: ${organisation.slug} (${organisation.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
