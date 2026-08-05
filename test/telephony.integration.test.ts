import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Telephony connection settings against real PostgreSQL: flag gate, admin-only
 * permissions, tenant isolation, per-provider credential validation,
 * encryption at rest, stage gates, disconnect, and audit trail.
 */

const TEST_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_URL ? describe : describe.skip;

process.env.OPERANTO_ENCRYPTION_KEY =
  process.env.OPERANTO_ENCRYPTION_KEY ?? "ab".repeat(32);

const db = new PrismaClient({ datasourceUrl: TEST_URL ?? "postgresql://unused" });
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/org-context", () => ({
  scope: (c: { organisation: { id: string } }) => ({
    organisationId: c.organisation.id,
  }),
}));

const {
  connectTelephony,
  listTelephonyConnections,
  setTelephonyStageGates,
  disableTelephonyConnection,
} = await import("@/lib/services/telephony");
const { decryptSecret } = await import("@/lib/crypto");

type Role = "ADMIN" | "SUPERVISOR" | "OPERATOR" | "AUDITOR";

async function makeCtx(slug: string, role: Role = "ADMIN") {
  const organisation =
    (await db.organisation.findUnique({ where: { slug } })) ??
    (await db.organisation.create({ data: { name: slug, slug } }));
  const user = await db.user.create({
    data: {
      email: `${slug}-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: `${role} of ${slug}`,
      status: "ACTIVE",
    },
  });
  const membership = await db.membership.create({
    data: { organisationId: organisation.id, userId: user.id, role, status: "ACTIVE" },
  });
  return {
    organisation,
    membership,
    user: { id: user.id, name: user.name, email: user.email },
  };
}

afterAll(async () => {
  await db.$disconnect();
});

describeDb("telephony connections", () => {
  it("is admin-only (channels:connect / channels:manage)", async () => {
    for (const role of ["SUPERVISOR", "OPERATOR", "AUDITOR"] as const) {
      const ctx = await makeCtx("tel-perms", role);
      await expect(
        connectTelephony(ctx, { provider: "ringover", displayName: "R", apiKey: "k" }),
      ).rejects.toThrow(/channels:connect/);
      await expect(listTelephonyConnections(ctx)).rejects.toThrow(/channels:manage/);
    }
  });

  it("validates exactly the catalog's fields per provider", async () => {
    const ctx = await makeCtx("tel-validate");
    await expect(
      connectTelephony(ctx, { provider: "nope", displayName: "X", apiKey: "k" }),
    ).rejects.toThrow(/Unknown telephony provider/);
    // CloudTalk needs key + secret.
    await expect(
      connectTelephony(ctx, { provider: "cloudtalk", displayName: "CT", apiKey: "key-only" }),
    ).rejects.toThrow(/API Secret is required/);
    // Twilio needs Account SID + Auth Token, no apiKey.
    await expect(
      connectTelephony(ctx, { provider: "twilio", displayName: "TW", apiSecret: "tok" }),
    ).rejects.toThrow(/Account SID is required/);
    // Generic: accountRef is optional.
    const generic = await connectTelephony(ctx, {
      provider: "other",
      displayName: "PBX",
      apiKey: "token",
    });
    expect(generic.connectionId).toBeTruthy();
  });

  it("stores credentials encrypted, returns the webhook secret exactly once", async () => {
    const ctx = await makeCtx("tel-crypto");
    const result = await connectTelephony(ctx, {
      provider: "cloudtalk",
      displayName: "Main line",
      apiKey: "key-123",
      apiSecret: "secret-456",
    });
    expect(result.webhookSecret).toMatch(/^[0-9a-f]{64}$/);

    const row = await db.telephonyConnection.findUnique({
      where: { id: result.connectionId },
    });
    expect(row?.apiKeyEncrypted).not.toContain("key-123");
    expect(row?.apiSecretEncrypted).not.toContain("secret-456");
    expect(decryptSecret(row!.apiKeyEncrypted!)).toBe("key-123");
    expect(decryptSecret(row!.apiSecretEncrypted!)).toBe("secret-456");
    expect(decryptSecret(row!.webhookSecretEncrypted!)).toBe(result.webhookSecret);

    // Public read path never exposes credential fields.
    const listed = await listTelephonyConnections(ctx);
    const publicRow = listed.find((c) => c.id === result.connectionId)!;
    expect(Object.keys(publicRow)).not.toContain("apiKeyEncrypted");
    expect(Object.keys(publicRow)).not.toContain("apiSecretEncrypted");
    expect(Object.keys(publicRow)).not.toContain("webhookSecretEncrypted");

    // Credentials never reach audit metadata.
    const auditRow = await db.auditEvent.findFirst({
      where: {
        organisationId: ctx.organisation.id,
        eventType: "telephony.connection_saved",
        targetId: result.connectionId,
      },
    });
    expect(auditRow).not.toBeNull();
    expect(JSON.stringify(auditRow!.afterMetadata)).not.toContain("key-123");
    expect(JSON.stringify(auditRow!.afterMetadata)).not.toContain("secret-456");
  });

  it("keeps tenants isolated and gates stages with audit", async () => {
    const orgA = await makeCtx("tel-a");
    const orgB = await makeCtx("tel-b");
    const { connectionId } = await connectTelephony(orgA, {
      provider: "sipgate",
      displayName: "Line A",
      apiKey: "tid",
      apiSecret: "tok",
    });

    expect((await listTelephonyConnections(orgB)).map((c) => c.id)).not.toContain(connectionId);
    await expect(
      setTelephonyStageGates(orgB, connectionId, { inboundEnabled: true }),
    ).rejects.toThrow(/not found/);

    await setTelephonyStageGates(orgA, connectionId, { inboundEnabled: true });
    let row = await db.telephonyConnection.findUnique({ where: { id: connectionId } });
    expect(row?.inboundEnabled).toBe(true);
    expect(row?.outboundEnabled).toBe(false);

    await disableTelephonyConnection(orgA, connectionId);
    row = await db.telephonyConnection.findUnique({ where: { id: connectionId } });
    expect(row?.status).toBe("DISABLED");
    expect(row?.inboundEnabled).toBe(false);

    const gateAudit = await db.auditEvent.findFirst({
      where: { eventType: "telephony.stage_gates_updated", targetId: connectionId },
    });
    expect(gateAudit).not.toBeNull();
  });
});
