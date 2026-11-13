import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { accounts } from "./fixtures/accounts";
import { waitForRenderedAnimations } from "./fixtures/renderedAnimations";
import { loginThroughUi } from "./fixtures/session";

async function expectNoSeriousAxeViolations(page: Page, route: string) {
  const response = await page.goto(route);
  expect(response?.status() ?? 200).toBeLessThan(500);
  if (route === '/driver') {
    await expect(page).toHaveURL(/\/driver\/(?:checklist|cargo|stops)\?trip=[^&]+(?:&welcome=1)?$/, { timeout: 20_000 });
    const entry = new URL(page.url()).pathname;
    if (entry.endsWith('checklist')) {
      await expect(page.getByText('Vamos conferir o veículo antes de abrir sua carga.', { exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { level: 1, name: entry.endsWith('stops') ? 'Paradas' : 'Conferência rápida', exact: true })).toBeVisible();
    }
    await expect(page.getByRole('status', { name: 'Carregando viagem' })).toHaveCount(0);
  }
  await expect(page.locator("main, [role=main]").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main, [role=main]").first().locator('h1').first()).toBeVisible();
  // Check the rendered page after finite entrance transitions finish. The axe
  // threshold and serious/critical assertion remain unchanged.
  await waitForRenderedAnimations(page.locator("main, [role=main]").first());

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();

  expect(
    results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")),
    `Serious/critical accessibility violations on ${route}`,
  ).toEqual([]);
}

test("operator critical workspaces have no serious axe violations", async ({ page }) => {
  await loginThroughUi(page, accounts.operator);
  await expectNoSeriousAxeViolations(page, "/loads");
  await expectNoSeriousAxeViolations(page, "/route-planning");
  await expectNoSeriousAxeViolations(page, "/financial");
  await expectNoSeriousAxeViolations(page, "/payables");
  await expectNoSeriousAxeViolations(page, "/closing-reports");
  await expectNoSeriousAxeViolations(page, "/billing-edi");
  await expectNoSeriousAxeViolations(page, "/driver-settlements");
  await expectNoSeriousAxeViolations(page, "/cost-centers");
});

test("driver critical workspaces have no serious axe violations", async ({ page }) => {
  await loginThroughUi(page, accounts.driver);
  await expectNoSeriousAxeViolations(page, "/driver");
  await expectNoSeriousAxeViolations(page, "/driver/loads");
  await expectNoSeriousAxeViolations(page, "/driver/expenses");

  await page.getByRole("button", { name: "Novo gasto", exact: true }).click();
  const source = page.getByRole("combobox", { name: "Viagem do gasto" });
  await expect(source).toBeVisible();
  const firstTrip = await source.locator("option").nth(1).getAttribute("value");
  expect(firstTrip).toBeTruthy();
  if (!firstTrip) throw new Error("The isolated driver fixture must expose an expense trip.");
  await source.selectOption(firstTrip);
  await expect(page.getByLabel("Valor (R$)")).toBeVisible();

  const dialogResults = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    dialogResults.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")),
  ).toEqual([]);
});

test("client critical workspaces have no serious axe violations", async ({ page }) => {
  await loginThroughUi(page, accounts.client);
  await expectNoSeriousAxeViolations(page, "/portal");
  await expectNoSeriousAxeViolations(page, "/portal/shipments");
});
