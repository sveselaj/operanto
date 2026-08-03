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
import { createCipheriv, createHash, randomBytes } from "node:crypto";
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

/** Fixture passwords come from the environment; never from this file. */
function requiredFixturePassword(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 16) {
    throw new Error(
      `${name} must be set (min 16 chars) to seed acceptance-test fixtures`,
    );
  }
  return value;
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

  // ── Acceptance-test fixtures (Playwright) ────────────────────────
  //
  // These create real, ACTIVE login accounts, so they are gated twice: they
  // refuse to run when NODE_ENV=production, and their passwords must be
  // supplied through the environment — never hardcoded here, because anything
  // in this file is a published credential.
  const wantFixtures =
    process.env.SEED_TEST_USERS === "1" || process.env.SEED_SECOND_ORG === "1";

  if (wantFixtures && process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed test fixtures with NODE_ENV=production. " +
        "Fixture accounts must never exist in a production database.",
    );
  }

  if (wantFixtures) {
    const isolationPassword = requiredFixturePassword(
      "SEED_TEST_ISOLATION_ADMIN_PASSWORD",
    );
    await upsertOrgWithAdmin({
      name: "Isolation Test Org",
      slug: "isolation-test",
      adminEmail: "admin@isolation-test.local",
      adminName: "Isolation Admin",
      adminPassword: isolationPassword,
    });
    console.log("Fixture organisation seeded (isolation-test).");
  }

  if (process.env.SEED_TEST_USERS === "1") {
    const operatorPassword = requiredFixturePassword(
      "SEED_TEST_OPERATOR_PASSWORD",
    );
    const operatorHash = await bcrypt.hash(operatorPassword, 12);
    const operator = await prisma.user.upsert({
      where: { email: "operator@operanto.local" },
      create: {
        email: "operator@operanto.local",
        name: "Test Operator",
        passwordHash: operatorHash,
        status: "ACTIVE",
        passwordUpdatedAt: new Date(),
      },
      // Keep the password in sync with the env on re-seed so a rotated
      // fixture password actually takes effect.
      update: { passwordHash: operatorHash, passwordUpdatedAt: new Date() },
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
    console.log("Fixture operator seeded (operator@operanto.local).");

    // ADMIN and SUPERVISOR must have a second factor, so the fixture admins
    // are enrolled with a KNOWN secret and deterministic recovery codes. The
    // acceptance suite then exercises the real 2FA sign-in rather than
    // bypassing it.
    //
    // This includes SEED_ADMIN_EMAIL, whose password is already a fixture
    // value in any environment where SEED_TEST_USERS=1. The shared secret is
    // why the whole fixture block is refused when NODE_ENV=production (above):
    // an account enrolled this way has a second factor anybody with the env
    // file can compute, which is no second factor at all.
    const totpSecret = requiredFixturePassword("SEED_TEST_TOTP_SECRET");
    const recoveryHashes = Array.from({ length: 60 }, (_, i) =>
      createHash("sha256")
        .update(`TEST${String(i).padStart(5, "0")}`)
        .digest("hex"),
    );
    const adminEmails = [adminEmail.toLowerCase(), "admin@isolation-test.local"];
    for (const email of adminEmails) {
      const target = await prisma.user.findUnique({ where: { email } });
      if (!target) continue;
      await prisma.user.update({
        where: { id: target.id },
        data: {
          totpSecretEncrypted: encryptSecret(totpSecret),
          totpConfirmedAt: new Date(),
          totpLastCounter: null,
          recoveryCodeHashes: recoveryHashes,
        },
      });
    }
    console.log(`Fixture 2FA enrolled for ${adminEmails.length} admin account(s).`);
  }

  console.log(`Seed complete. Organisation: ${organisation.slug} (${organisation.id})`);
  // ── Growth Prospecting Program demo fixtures (G1) ─────────────────
  // Entirely fictional companies and people; every domain is .example
  // (reserved, unroutable). Gated so ordinary seeds stay lean.
  if (process.env.SEED_GROWTH_DEMO === "1") {
    const existing = await prisma.targetProfile.findFirst({
      where: { organisationId: organisation.id, name: "DACH Fenster & Renovierung (Demo)" },
    });
    if (!existing) {
      const profile = await prisma.targetProfile.create({
        data: {
          organisationId: organisation.id,
          name: "DACH Fenster & Renovierung (Demo)",
          description:
            "Fictional demo profile: German window/renovation installers, 10–100 employees, visible inquiry processes.",
          industries: ["windows", "renovation", "home_improvement"],
          regions: ["DE", "AT", "CH-de"],
          companySizeMin: 10,
          companySizeMax: 100,
          characteristics: ["multiple branches", "quotation forms", "phone-based intake"],
          decisionMakerRoles: ["Geschäftsführer", "Vertriebsleiter", "Leiter Kundenservice"],
          positiveSignals: ["active advertising", "many reviews", "hiring service staff"],
          negativeSignals: ["franchise HQ elsewhere", "no local operations"],
          exclusionCriteria: ["competitors", "existing customers"],
          operantoUseCases: ["unified inbox", "quotation intake", "WhatsApp handling", "follow-up automation"],
          languages: ["de"],
          scoringWeights: { profileFit: 20, operationalPain: 20, interactionVolume: 15, digitalReadiness: 15, budget: 10, access: 10, strategic: 5, evidenceQuality: 5 },
          status: "ACTIVE",
        },
      });

      const companies = [
        { name: "Fenster Nordlicht GmbH", domain: "fenster-nordlicht.example", city: "Hamburg", status: "READY_FOR_ASSESSMENT" },
        { name: "Rheinblick Fensterbau AG", domain: "rheinblick-fenster.example", city: "Köln", status: "READY_FOR_ASSESSMENT" },
        { name: "Alpenglas Montagen GmbH", domain: "alpenglas-montagen.example", city: "München", status: "READY_FOR_ASSESSMENT" },
        { name: "Sanierung Sonnenhof UG", domain: "sonnenhof-sanierung.example", city: "Leipzig", status: "APPROVED" },
        { name: "Fensterwerk Elbtal GmbH", domain: "fensterwerk-elbtal.example", city: "Dresden", status: "APPROVED" },
        { name: "Renovex Süd GmbH", domain: "renovex-sued.example", city: "Stuttgart", status: "REJECTED" },
        { name: "Hausmodern Weserland KG", domain: "hausmodern-weserland.example", city: "Bremen", status: "REJECTED" },
        { name: "Glasklar Fenster Berlin GmbH", domain: "glasklar-berlin.example", city: "Berlin", status: "DRAFT_PREPARED" },
        { name: "Isolierprofi Ruhr GmbH", domain: "isolierprofi-ruhr.example", city: "Essen", status: "CONTACTED" },
        { name: "Wintergarten Taunus GmbH", domain: "wintergarten-taunus.example", city: "Frankfurt", status: "REPLIED" },
        { name: "Fassaden Franken OHG", domain: "fassaden-franken.example", city: "Nürnberg", status: "NEEDS_REVIEW" },
        // Insufficient-data account: no domain, no evidence.
        { name: "Bauelemente Nord (unvollständig)", domain: null, city: null, status: "NEEDS_REVIEW" },
      ] as const;

      const created: { id: string; name: string; status: string }[] = [];
      for (const company of companies) {
        const account = await prisma.growthAccount.create({
          data: {
            organisationId: organisation.id,
            targetProfileId: profile.id,
            name: company.name,
            nameNormalized: company.name.toLowerCase().replace(/gmbh|ag|ug|kg|ohg|[^a-zäöüß0-9 ]/g, " ").replace(/\s+/g, " ").trim(),
            domain: company.domain,
            domainNormalized: company.domain,
            website: company.domain ? `https://${company.domain}` : null,
            industry: "windows_renovation",
            country: "DE",
            city: company.city,
            employeeEstimate: 10 + created.length * 6,
            status: company.status,
            sources: {
              create: {
                organisationId: organisation.id,
                provider: "seed_demo",
                providerRecordId: `seed-${company.domain ?? company.name}`,
                importBatchId: "seed-growth-demo",
              },
            },
          },
        });
        created.push({ id: account.id, name: account.name, status: company.status });
      }

      // Duplicate example: a second source record pointing at the first
      // account (constraint would refuse a second row with the same domain).
      await prisma.accountSourceRecord.create({
        data: {
          organisationId: organisation.id,
          accountId: created[0]!.id,
          provider: "seed_demo_csv",
          providerRecordId: "seed-duplicate-1",
          duplicateOfAccountId: created[0]!.id,
          importBatchId: "seed-growth-demo",
        },
      });

      // Evidence + scores + brief for the assessment/approved accounts.
      for (const account of created.slice(0, 5)) {
        const run = await prisma.researchRun.create({
          data: {
            organisationId: organisation.id,
            accountId: account.id,
            provider: "mock",
            status: "COMPLETED",
            startedAt: new Date(),
            completedAt: new Date(),
          },
        });
        const fact = await prisma.researchEvidence.create({
          data: {
            organisationId: organisation.id,
            accountId: account.id,
            researchRunId: run.id,
            category: "locations",
            claim: "Operates three branches in the region",
            classification: "VERIFIED_FACT",
            sourceType: "website",
            sourceUrl: `https://${account.name.toLowerCase().slice(0, 6)}.example/standorte`,
            sourceTitle: "Standorte",
            excerpt: "Unsere Standorte: drei Niederlassungen (fiktiv).",
            confidence: 0.9,
            provider: "mock",
          },
        });
        const inference = await prisma.researchEvidence.create({
          data: {
            organisationId: organisation.id,
            accountId: account.id,
            researchRunId: run.id,
            category: "service_load",
            claim: "Likely receives inquiries through multiple uncoordinated teams",
            classification: "INFERENCE",
            sourceType: "analysis",
            confidence: 0.6,
            provider: "mock",
          },
        });
        await prisma.researchEvidence.create({
          data: {
            organisationId: organisation.id,
            accountId: account.id,
            researchRunId: run.id,
            category: "budget",
            claim: "May have budget for digital tooling next fiscal year",
            classification: "HYPOTHESIS",
            sourceType: "analysis",
            confidence: 0.3,
            provider: "mock",
          },
        });
        await prisma.accountScore.create({
          data: {
            organisationId: organisation.id,
            accountId: account.id,
            aiScore: 62 + created.indexOf(account) * 5,
            aiComponents: { profileFit: 16, operationalPain: 14, interactionVolume: 12, digitalReadiness: 9, budget: 6, access: 5 },
            aiExplanation: "Fictional demo score derived from mock evidence.",
            aiModel: "mock",
            aiPromptVersion: "growth-demo@1",
            confidence: 0.55,
            missingData: ["revenue estimate", "decision-maker contact"],
          },
        });
        await prisma.accountBrief.create({
          data: {
            organisationId: organisation.id,
            accountId: account.id,
            version: 1,
            sections: {
              summary: "Fictional regional installer with three branches.",
              profileAlignment: "Matches size and inquiry-process criteria.",
              verifiedFacts: [fact.id],
              inferences: [inference.id],
              missing: ["revenue estimate"],
              recommendedUseCases: ["unified inbox", "quotation intake"],
              doNotUse: ["pricing", "competitor comparisons"],
            },
            evidenceIds: [fact.id, inference.id],
            generatedByModel: "mock",
            promptVersion: "growth-demo@1",
          },
        });
      }

      // Playbook + drafts: one heavily edited (2 versions), one approved,
      // one manually sent.
      const playbook = await prisma.outreachPlaybook.create({
        data: {
          organisationId: organisation.id,
          targetProfileId: profile.id,
          name: "DACH Erstkontakt E-Mail (Demo)",
          language: "de",
          channel: "email",
          valuePropositions: ["Ein Posteingang für alle Kundenanfragen", "Schnellere Angebotserstellung"],
          approvedClaims: ["Operanto bündelt Anfragen aus mehreren Kanälen"],
          prohibitedClaims: ["Preisgarantien", "Zertifizierungszusagen", "Kundenreferenzen"],
          tone: "sachlich, respektvoll, kurz",
          callToAction: "15-minütiges Kennenlerngespräch",
          requiredFooter: "Demo-Fußzeile (fiktiv) — Abmeldung jederzeit möglich.",
        },
      });
      const draftTargets = [created[7]!, created[8]!, created[9]!];
      const statuses = ["AWAITING_REVIEW", "APPROVED", "MANUALLY_SENT"] as const;
      for (let i = 0; i < draftTargets.length; i++) {
        const draft = await prisma.outreachDraft.create({
          data: {
            organisationId: organisation.id,
            accountId: draftTargets[i]!.id,
            playbookId: playbook.id,
            language: "de",
            subject: `Anfragenbündelung bei ${draftTargets[i]!.name} (Demo)`,
            body: "Fiktiver Demo-Entwurf: Bezug auf drei Standorte und Angebotsprozesse. " + (playbook.requiredFooter ?? ""),
            callToAction: "Kennenlerngespräch",
            evidenceIds: [],
            promptVersion: "growth-demo@1",
            model: "mock",
            status: statuses[i]!,
            ...(statuses[i] === "MANUALLY_SENT"
              ? { manuallySentAt: new Date(), manualChannel: "email", decidedAt: new Date() }
              : {}),
            ...(statuses[i] === "APPROVED" ? { decidedAt: new Date() } : {}),
          },
        });
        await prisma.outreachDraftVersion.create({
          data: {
            organisationId: organisation.id,
            draftId: draft.id,
            version: 1,
            subject: draft.subject,
            body: draft.body,
          },
        });
        if (i === 0) {
          // Heavily edited draft — second version differs substantially.
          await prisma.outreachDraftVersion.create({
            data: {
              organisationId: organisation.id,
              draftId: draft.id,
              version: 2,
              subject: draft.subject,
              body: "Vollständig überarbeiteter fiktiver Entwurf (menschliche Korrektur). " + (playbook.requiredFooter ?? ""),
            },
          });
        }
      }
      console.log(`Seeded Growth demo: profile, ${created.length} fictional accounts, evidence, scores, briefs, drafts`);
    }
  }

}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
