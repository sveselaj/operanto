/**
 * Controlled staging verification of invitation delivery.
 *
 *   pnpm tsx scripts/verify-invitation-delivery.ts send    <email>
 *   pnpm tsx scripts/verify-invitation-delivery.ts accept  <invite-url>
 *
 * Two phases on purpose: the raw token exists only inside the delivered
 * email (only its hash is stored), so a human must open the mailbox. That is
 * the property being verified, not an inconvenience to work around.
 *
 * `send` asserts the provider accepted the message and that delivery was
 * recorded honestly. `accept` consumes the link from the email, then proves
 * the token is single-use.
 *
 * Run against STAGING only.
 */
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const [command, argument] = process.argv.slice(2);

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function send(email: string) {
  if (!email) fail("usage: send <email>");
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    fail("RESEND_API_KEY and EMAIL_FROM must be set to verify real delivery");
  }
  const org = await prisma.organisation.findFirstOrThrow({
    where: { slug: "pronatona" },
  });

  // Mirror inviteMember(): revoke any outstanding invitation, mint a fresh
  // token, and send through the same provider boundary the app uses.
  const token = randomBytes(32).toString("base64url");
  const invitation = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({
      where: { organisationId: org.id, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return tx.invitation.create({
      data: {
        organisationId: org.id,
        email,
        role: "OPERATOR",
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
      },
    });
  });

  const acceptUrl = `${APP_URL}/invite/${token}`;
  if (!acceptUrl.startsWith("https://staging.operanto.ai/invite/")) {
    fail(`invitation URL is not a staging URL: ${APP_URL}/invite/…`);
  }

  const { deliverInvitation } = await import("../src/lib/email");
  const result = await deliverInvitation({
    to: email,
    organisationName: org.name,
    role: "OPERATOR",
    acceptUrl,
    expiresAt: invitation.expiresAt,
  });

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: {
      deliveryAttempts: { increment: 1 },
      deliveredAt: result.delivered ? new Date() : null,
      lastDeliveryError: result.delivered ? null : result.reason.slice(0, 500),
    },
  });

  if (!result.delivered) fail(`provider did not accept the message: ${result.reason}`);

  const stored = await prisma.invitation.findUniqueOrThrow({
    where: { id: invitation.id },
  });
  console.log("PASS: provider accepted the message");
  console.log(`PASS: delivery recorded (deliveredAt=${stored.deliveredAt?.toISOString()})`);
  console.log(`PASS: invitation URL points at ${APP_URL}`);
  console.log("");
  console.log("Now open the mailbox and check by eye:");
  console.log(`  • sender is exactly:  ${process.env.EMAIL_FROM}`);
  if (process.env.EMAIL_REPLY_TO) {
    console.log(`  • reply-to is:        ${process.env.EMAIL_REPLY_TO}`);
  }
  console.log(`  • the link begins:    ${APP_URL}/invite/`);
  console.log("");
  console.log("Then run:");
  console.log("  pnpm tsx scripts/verify-invitation-delivery.ts accept <link-from-email>");
}

async function accept(url: string) {
  if (!url) fail("usage: accept <invite-url>");
  const token = url.trim().split("/invite/")[1]?.split(/[?#]/)[0];
  if (!token) fail("could not read a token from that URL");

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hash(token) },
  });
  if (!invitation) fail("no invitation matches that link (wrong environment?)");
  if (invitation.revokedAt) fail("that invitation was revoked — use the newest email");
  if (invitation.acceptedAt) fail("that invitation was already accepted");
  console.log("PASS: the emailed link resolves to a live invitation");

  const { acceptInvitation } = await import("../src/lib/services/members");
  await acceptInvitation({
    token,
    name: "Staging Delivery Check",
    password: `Verify-${randomBytes(12).toString("base64url")}`,
  });
  console.log("PASS: invitation accepted");

  // Single-use: the same token must now be refused.
  let refused = false;
  try {
    await acceptInvitation({
      token,
      name: "Second Use",
      password: `Verify-${randomBytes(12).toString("base64url")}`,
    });
  } catch {
    refused = true;
  }
  console.log(
    refused
      ? "PASS: the token is single-use — reuse refused"
      : "FAIL: the token was accepted twice",
  );
  if (!refused) process.exit(1);

  console.log("");
  console.log("Clean up the created account when finished:");
  console.log(`  DELETE FROM "User" WHERE email = '${invitation.email}';`);
}

const run = command === "send" ? send : command === "accept" ? accept : null;
if (!run) fail("usage: verify-invitation-delivery.ts <send|accept> <arg>");

run(argument)
  .catch((error) => fail(error instanceof Error ? error.message : String(error)))
  .finally(() => prisma.$disconnect());
