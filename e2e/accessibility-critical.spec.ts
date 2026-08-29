import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { accounts } from "./fixtures/accounts";
import { loginThroughUi } from "./fixtures/session";

async function expectNoSeriousAxeViolations(page: Page, route: string) {
  const response = await page.goto(route);
  expect(response?.status() ?? 200).toBeLessThan(500);
  await expect(page.locator("main, [role=main]").first()).toBeVisible({ timeout: 20_000 });

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();

  expect(
    results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")),
  ).toEqual([]);
}

test("operator critical workspaces have no serious axe violations", async ({ page }) => {
  await loginThroughUi(page, accounts.operator);
  await expectNoSeriousAxeViolations(page, "/loads");
  await expectNoSeriousAxeViolations(page, "/route-planning");
});

test("driver critical workspaces have no serious axe violations", async ({ page }) => {
  await loginThroughUi(page, accounts.driver);
  await expectNoSeriousAxeViolations(page, "/driver");
  await expectNoSeriousAxeViolations(page, "/driver/loads");
});

test("client critical workspaces have no serious axe violations", async ({ page }) => {
  await loginThroughUi(page, accounts.client);
  await expectNoSeriousAxeViolations(page, "/portal");
  await expectNoSeriousAxeViolations(page, "/portal/shipments");
});
