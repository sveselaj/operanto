import { expect, test } from "@playwright/test";
import {
  adminCredentials,
  buildLeadCreatedEnvelope,
  login,
  postSignedEvent,
  processPendingEvents,
  webhookSecret,
} from "./helpers";

/**
 * Webhook-secret rotation through the real admin UI:
 * old secret works → rotate → old stops working, new works → audited →
 * plaintext never rendered. Rotates BACK at the end so the environment stays
 * consistent with .env. (AES-GCM tamper rejection is covered by unit tests.)
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

async function rotateTo(page: import("@playwright/test").Page, secret: string) {
  await page.goto("/integrations/pronatona");
  await page
    .getByPlaceholder("New shared secret (min 32 chars)")
    .fill(secret);
  await page.getByRole("button", { name: "Rotate secret" }).click();
  await expect(page.getByText(/Secret rotated/)).toBeVisible();
}

test.describe.serial("webhook secret rotation", () => {
  test("old works before; after rotation old fails, new works; audited; no plaintext", async ({
    page,
    request,
  }) => {
    const original = webhookSecret();
    const { email, password } = adminCredentials();
    await login(page, email, password);

    // Baseline: current secret is accepted.
    const before = await postSignedEvent(request, freshEnvelope("before"), {
      secret: original,
    });
    expect(before.status()).toBe(202);

    await rotateTo(page, NEW_SECRET);
    try {
      // Immediate cutover policy: the old secret stops working at once…
      const oldAfter = await postSignedEvent(request, freshEnvelope("old"), {
        secret: original,
      });
      expect(oldAfter.status()).toBe(401);

      // …and the new secret is accepted.
      const newAfter = await postSignedEvent(request, freshEnvelope("new"), {
        secret: NEW_SECRET,
      });
      expect(newAfter.status()).toBe(202);

      // The rotation is audited.
      await page.goto("/audit");
      await expect(
        page.getByText("integration.secret_rotated").first(),
      ).toBeVisible();

      // Plaintext secrets are never rendered anywhere on the health page.
      await page.goto("/integrations/pronatona");
      const html = await page.content();
      expect(html).not.toContain(NEW_SECRET);
      expect(html).not.toContain(original);
    } finally {
      // Restore the .env secret so subsequent runs stay consistent.
      await rotateTo(page, original);
    }

    const restored = await postSignedEvent(request, freshEnvelope("restored"), {
      secret: original,
    });
    expect(restored.status()).toBe(202);
    await processPendingEvents(request);
  });
});
