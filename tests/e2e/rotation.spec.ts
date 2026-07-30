import { expect, test, type Page } from "@playwright/test";
import {
  adminCredentials,
  buildLeadCreatedEnvelope,
  login,
  postSignedEvent,
  waitForEventProcessed,
  webhookSecret,
} from "./helpers";

/**
 * Webhook-secret rotation through the real admin UI:
 * old secret works → rotate → old stops working, new works → audited →
 * plaintext never rendered → restore.
 *
 * Restore safety: the rotation is performed INSIDE the try block and the
 * finally block always restores the original secret, so a mid-test failure
 * cannot leave the environment signed with a random value that exists nowhere
 * else. (AES-GCM tamper rejection is covered by crypto.test.ts.)
 */

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const NEW_SECRET = `rotated-secret-${run}-abcdefghijklmnopqrstuvwxyz`;

function freshEnvelope(tag: string) {
  return buildLeadCreatedEnvelope({
    leadId: `lead_rot_${tag}_${run}`,
    customerName: `Rotation Probe ${tag} ${run}`,
    customerEmail: `rot.${tag}.${run}@example.com`,
  });
}

async function rotateTo(page: Page, secret: string) {
  await page.goto("/integrations/pronatona");
  await page.getByPlaceholder("New shared secret (min 32 chars)").fill(secret);
  await page.getByRole("button", { name: "Rotate secret" }).click();
  // Generous timeout: the confirmation appears only after the DB write, and a
  // premature failure here is exactly what would strand a rotated secret.
  await expect(page.getByText(/Secret rotated/)).toBeVisible({ timeout: 30_000 });
}

/** Number of rotation audit rows currently visible (org-scoped, newest 150). */
async function rotationAuditCount(page: Page): Promise<number> {
  await page.goto("/audit");
  return page.getByText("integration.secret_rotated").count();
}

test.describe.serial("webhook secret rotation", () => {
  test("old works before; after rotation old fails, new works; audited; no plaintext", async ({
    page,
    request,
  }) => {
    const original = webhookSecret();
    const { email, password } = adminCredentials();
    await login(page, email, password);

    // Baseline: current secret is accepted, and count existing audit rows so
    // the "is it audited" assertion cannot be satisfied by earlier runs.
    const before = await postSignedEvent(request, freshEnvelope("before"), {
      secret: original,
    });
    expect(before.status()).toBe(202);
    const auditRowsBefore = await rotationAuditCount(page);

    try {
      await rotateTo(page, NEW_SECRET);

      // Immediate cutover policy: the old secret stops working at once…
      const oldAfter = await postSignedEvent(request, freshEnvelope("old"), {
        secret: original,
      });
      expect(oldAfter.status()).toBe(401);

      // …and the new secret is accepted.
      const newEnvelope = freshEnvelope("new");
      const newAfter = await postSignedEvent(request, newEnvelope, {
        secret: NEW_SECRET,
      });
      expect(newAfter.status()).toBe(202);
      await waitForEventProcessed(request, String(newEnvelope.eventId));

      // THIS rotation produced a new audit row.
      expect(await rotationAuditCount(page)).toBeGreaterThan(auditRowsBefore);

      // Plaintext secrets are never rendered anywhere on the health page.
      await page.goto("/integrations/pronatona");
      const html = await page.content();
      expect(html).not.toContain(NEW_SECRET);
      expect(html).not.toContain(original);
    } finally {
      // Always restore the .env secret, even if an assertion above failed.
      await rotateTo(page, original);
    }

    const restoredEnvelope = freshEnvelope("restored");
    const restored = await postSignedEvent(request, restoredEnvelope, {
      secret: original,
    });
    expect(restored.status()).toBe(202);
    await waitForEventProcessed(request, String(restoredEnvelope.eventId));
  });
});
