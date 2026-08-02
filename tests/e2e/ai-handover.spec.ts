import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { adminCredentials, login } from "./helpers";

/**
 * AI handover, end to end in MOCK mode: enable AI in settings → summary,
 * classification, draft → edit → approve → record as manual message →
 * explicit follow-up task → takeover/release → audit continuity. No live
 * provider, no external send — the mock is deterministic, so every
 * assertion is exact.
 */

test.skip(
  Boolean(process.env.PLAYWRIGHT_BASE_URL),
  "simulator ingestion needs local database access",
);

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

function ingestScenario(scenario: "nagelista" | "pronatona", runId: string): string {
  const output = execFileSync(
    "pnpm",
    ["tsx", "scripts/simulate-conversation.ts", "--scenario", scenario, "--run", runId],
    {
      env: { ...process.env, NODE_OPTIONS: "--require ./scripts/preload.cjs" },
      encoding: "utf8",
    },
  );
  const match = output.match(/conversation (\w+)/);
  if (!match) throw new Error(`Unexpected simulator output: ${output}`);
  return match[1]!;
}

async function screenshot(page: Page, name: string) {
  const dir = process.env.SCREENSHOT_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test.describe.serial("AI handover (mock mode)", () => {
  test("admin enables AI assistance in mock mode", async ({ page }) => {
    const admin = adminCredentials();
    await login(page, admin.email, admin.password);
    await page.goto("/settings/organisation");
    const enable = page.getByLabel("Enable AI assistance for this organisation");
    if (!(await enable.isChecked())) await enable.check();
    await page.getByRole("button", { name: "Save AI settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  });

  test("Nagelista: summary, classification, draft, edit, approve, record, task", async ({
    page,
  }) => {
    const conversationId = ingestScenario("nagelista", `ai${run}`);
    const admin = adminCredentials();
    await login(page, admin.email, admin.password);
    await page.goto(`/conversations/${conversationId}`);

    await expect(page.getByText("Mock mode")).toBeVisible();

    // Summary — never invents shipment status.
    await page.getByRole("button", { name: "Summarise" }).click();
    await expect(
      page.getByText("No shipment information is available in this conversation."),
    ).toBeVisible();

    // Classification — order-status intent.
    await page.getByRole("button", { name: "Classify" }).click();
    await expect(page.getByText("ORDER_STATUS")).toBeVisible();

    // Draft — risk, confidence, and missing information are shown.
    await page.getByRole("button", { name: "Draft reply", exact: true }).click();
    await expect(page.getByText("Risk: MEDIUM").first()).toBeVisible();
    await expect(page.getByText(/Confidence \d+%/).first()).toBeVisible();
    await expect(page.getByText(/Missing information:/)).toBeVisible();

    // Edit before approval.
    const edited = `Hello, we are checking your shipment now. [edited ${run}]`;
    await page.getByLabel("Draft reply").fill(edited);
    await page.getByRole("button", { name: "Save edit" }).click();

    // Approve, then explicitly record as a manual message.
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("button", { name: "Record as manual message" }).click();
    await expect(
      page.locator("section", { hasText: "Messages" }).getByText(edited).first(),
    ).toBeVisible();

    // Follow-up task only through explicit human action.
    await page.getByRole("button", { name: "Recommend action" }).click();
    await page
      .getByRole("button", {
        name: "Create follow-up task: Check shipment status with fulfilment",
      })
      .click();
    await expect(
      page.getByText("Check shipment status with fulfilment").first(),
    ).toBeVisible();
    await screenshot(page, "ai-panel-nagelista");

    // Audit continuity — event types only, no content.
    await page.goto("/audit?target=AIAction");
    for (const eventType of [
      "ai.summary.completed",
      "ai.classification.completed",
      "ai.reply_draft.completed",
      "ai.draft.approved",
    ]) {
      await expect(page.getByText(eventType).first()).toBeVisible();
    }
  });

  test("Pronatona: personalised draft, reject, takeover and release", async ({
    page,
  }) => {
    const conversationId = ingestScenario("pronatona", `ai${run}`);
    const admin = adminCredentials();
    await login(page, admin.email, admin.password);
    await page.goto(`/conversations/${conversationId}`);

    // Summary carries the extracted requirement.
    await page.getByRole("button", { name: "Summarise" }).click();
    await expect(page.getByText(/two-bedroom apartment in Prishtina/)).toBeVisible();
    await expect(page.getByText(/€150,000/).first()).toBeVisible();

    await page.getByRole("button", { name: "Classify" }).click();
    await expect(page.getByText("PROPERTY_SEARCH")).toBeVisible();

    // Draft is personalised but invents no availability.
    await page.getByRole("button", { name: "Draft reply", exact: true }).click();
    const draftBox = page.getByLabel("Draft reply");
    await expect(draftBox).toBeVisible();
    const draftText = await draftBox.inputValue();
    expect(draftText).toContain("€150,000");
    expect(draftText).not.toMatch(/available now|we have an apartment|found a match/i);

    await page.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText("Draft rejected.", { exact: true })).toBeVisible();

    // Human takeover — AI stays request-only either way.
    await page.getByRole("button", { name: "Take control" }).click();
    await expect(page.getByText("Human controlled")).toBeVisible();
    await page.getByRole("button", { name: "Summarise" }).click();
    await expect(
      page.getByText(/two-bedroom apartment in Prishtina/).first(),
    ).toBeVisible();
    await screenshot(page, "ai-panel-takeover");

    await page.getByRole("button", { name: "Release to AI-assisted" }).click();
    await expect(page.getByText("AI assisted", { exact: true })).toBeVisible();

    await page.goto("/audit?target=Conversation");
    for (const eventType of ["conversation.takeover", "conversation.released"]) {
      await expect(page.getByText(eventType).first()).toBeVisible();
    }
  });
});
