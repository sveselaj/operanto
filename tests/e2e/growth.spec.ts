import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { adminCredentials, FOREIGN_ADMIN, login } from "./helpers";

/**
 * Growth G2, end to end: target-profile management, the staged CSV import
 * (preview → map → duplicates → commit), account review actions, the
 * suppression-survives-import invariant, contact erasure, and tenant
 * isolation. The Growth flag is enabled for this server via the Playwright
 * web-server env; disabled-state behaviour is covered at unit level
 * (single-server E2E cannot flip a boot-time environment variable).
 */

test.skip(
  Boolean(process.env.PLAYWRIGHT_BASE_URL),
  "growth e2e needs the local flag-enabled server and database access",
);

const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const profileName = `DACH Renovation E2E ${run}`;
const companyA = `Fenster Alpha E2E ${run}`;
const companyB = `Fenster Beta E2E ${run}`;
const domainA = `alpha-${run}.example`;
const contactEmail = `kontakt@alpha-${run}.example`;

function csv(rows: string[][]): { name: string; mimeType: string; buffer: Buffer } {
  const text = rows.map((r) => r.join(",")).join("\n");
  return { name: `import-${run}.csv`, mimeType: "text/csv", buffer: Buffer.from(text, "utf8") };
}

const HEADER = ["Firma", "Website", "Stadt", "land", "Vorname", "contact email"];

async function uploadAndPreview(page: Page, file: ReturnType<typeof csv>) {
  await page.goto("/growth/accounts/import");
  await page.getByLabel("CSV file").setInputFiles(file);
  await page.getByRole("button", { name: /Preview file|Re-run preview/ }).click();
  await expect(page.getByText("Column mapping")).toBeVisible();
}

test.describe.serial("growth G2", () => {
  test("target profile: create, edit, activate, visible in overview", async ({ page }) => {
    const admin = adminCredentials();
    await login(page, admin.email, admin.password);
    await page.goto("/growth");
    await expect(page.getByRole("heading", { name: "Growth" })).toBeVisible();

    await page.goto("/growth/target-profiles/new");
    await page.getByLabel("Profile name").fill(profileName);
    await page.getByLabel("Countries / regions").fill("DE, AT");
    await page.getByLabel("Employees (min)").fill("10");
    await page.getByLabel("Employees (max)").fill("100");
    await page.getByRole("button", { name: "Create profile" }).click();
    await page.waitForURL("**/growth/target-profiles/**");

    await page.getByLabel("Positive signals").fill("many reviews, hiring");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.getByRole("button", { name: "Activate" }).click();
    await expect(page.getByText("active", { exact: true })).toBeVisible();

    await page.goto("/growth/target-profiles");
    await expect(page.getByRole("link", { name: profileName })).toBeVisible();
  });

  test("csv import: preview, invalid rows, duplicate resolution, commit", async ({ page }) => {
    const admin = adminCredentials();
    await login(page, admin.email, admin.password);

    // First import: two clean rows (A with contact, B without domain issues).
    await uploadAndPreview(
      page,
      csv([
        HEADER,
        [companyA, domainA, "Hamburg", "DE", "Mira", contactEmail],
        [companyB, `beta-${run}.example`, "Köln", "DE", "", ""],
      ]),
    );
    await expect(page.getByText("Ready").locator("..")).toContainText("2");
    await page.getByRole("button", { name: "Commit import" }).click();
    await expect(page.getByText("Import committed")).toBeVisible();

    // Second import: exact duplicate of A, an invalid row, and a fresh row.
    await uploadAndPreview(
      page,
      csv([
        HEADER,
        [companyA, domainA, "Hamburg", "DE", "", ""],
        ["", `nameless-${run}.example`, "", "DE", "", ""],
        [`Fenster Gamma E2E ${run}`, `gamma-${run}.example`, "Bonn", "DE", "", ""],
      ]),
    );
    await expect(page.getByText(/exact duplicate/)).toBeVisible();
    await expect(page.getByText(/missing_name/)).toBeVisible();
    // Resolve the duplicate: keep default Skip (explicit human decision made
    // by inspecting it), accept partial for the invalid row.
    await page.getByLabel(/Import the valid rows anyway/).check();
    await page.getByRole("button", { name: "Commit import" }).click();
    await expect(page.getByText("Import committed")).toBeVisible();
    await expect(page.getByText(/1 account.* created/)).toBeVisible();

    // Account list shows the imports; open A.
    await page.goto("/growth/accounts");
    await page.getByLabel("Search accounts").fill(companyA);
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("link", { name: companyA }).click();
    await page.waitForURL("**/growth/accounts/**");
    await expect(page.getByText(domainA).first()).toBeVisible();
    await expect(page.getByText("Mira")).toBeVisible();

    // Assign an owner, move the lifecycle, verify the timeline.
    await page.getByLabel("Account owner").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Save owner" }).click();
    await page.getByRole("button", { name: "Accept for research" }).click();
    await expect(page.getByText("ready for research").first()).toBeVisible();
    await expect(page.getByText("Account owner assigned")).toBeVisible();
    await expect(page.getByText("Account moved to ready for research")).toBeVisible();
  });

  test("suppression survives re-import; erasure removes contact data", async ({ page }) => {
    const admin = adminCredentials();
    await login(page, admin.email, admin.password);

    // Suppress company B from its account page.
    await page.goto("/growth/accounts");
    await page.getByLabel("Search accounts").fill(companyB);
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("link", { name: companyB }).click();
    await page.getByRole("button", { name: "Suppress", exact: true }).click();
    await expect(page.getByText(/Suppressed .* excluded from all future Growth execution/)).toBeVisible();

    // Re-importing the suppressed domain is flagged and cannot reactivate.
    await uploadAndPreview(
      page,
      csv([HEADER, [companyB, `beta-${run}.example`, "Köln", "DE", "", ""]]),
    );
    await expect(page.getByText(/exact duplicate/)).toBeVisible();

    // Erase the imported contact via the privacy service (no UI by design),
    // then confirm the account page shows the redacted state.
    const script = `
import "dotenv/config";
async function main() {
  const { prisma } = await import("@/lib/prisma");
  const contact = await prisma.growthContact.findFirstOrThrow({
    where: { emailNormalized: ${JSON.stringify(contactEmail)} },
    include: { organisation: { include: { memberships: { where: { role: "ADMIN" }, take: 1 } } } },
  });
  const { eraseGrowthContact } = await import("@/lib/services/growth/accounts");
  await eraseGrowthContact(
    {
      organisation: { id: contact.organisationId },
      membership: { id: contact.organisation.memberships[0].id, role: "ADMIN" },
      user: { id: "e2e", name: "e2e", email: "e2e@example.com" },
    },
    contact.id,
    "e2e privacy flow",
  );
  await prisma.$disconnect();
  console.log("erased");
}
main().catch((e) => { console.error(e); process.exit(1); });
`;
    writeFileSync("scripts/tmp-e2e-erase.ts", script);
    try {
      execFileSync("pnpm", ["tsx", "scripts/tmp-e2e-erase.ts"], {
        env: { ...process.env, NODE_OPTIONS: "--require ./scripts/preload.cjs" },
        encoding: "utf8",
      });
    } finally {
      unlinkSync("scripts/tmp-e2e-erase.ts");
    }

    await page.goto("/growth/accounts");
    await page.getByLabel("Search accounts").fill(companyA);
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("link", { name: companyA }).click();
    await expect(page.getByText("(erased contact)")).toBeVisible();
    await expect(page.getByText("Mira")).toHaveCount(0);
  });

  test("tenant isolation: a foreign organisation sees nothing", async ({ page }) => {
    await login(page, FOREIGN_ADMIN.email, FOREIGN_ADMIN.password());
    await page.goto("/growth/accounts");
    await page.getByLabel("Search accounts").fill(companyA);
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByRole("link", { name: companyA })).toHaveCount(0);
    await expect(page.getByText("No accounts match")).toBeVisible();
    await page.goto("/growth/target-profiles");
    await expect(page.getByRole("link", { name: profileName })).toHaveCount(0);
  });
});
