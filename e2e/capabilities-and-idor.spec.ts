import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { accounts, fixtureIds } from "./fixtures/accounts";
import { loginThroughUi, passwordToken } from "./fixtures/session";

test("@critical fiscal route is visibly disabled for launch tenants", async ({ page }) => {
  await loginThroughUi(page, accounts.operator);
  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Integração em implantação" })).toBeVisible();
  await expect(page.getByText(/Nenhuma sincronização, emissão ou cancelamento será executado/)).toBeVisible();
});

test("@critical known cross-tenant IDs return no REST rows", async ({ request }) => {
  const session = await passwordToken(request, accounts.operator);
  const headers = {
    apikey: session.publishableKey,
    Authorization: `Bearer ${session.accessToken}`,
  };

  for (const [table, id] of [["clients", fixtureIds.clientB], ["loads", fixtureIds.loadB]] as const) {
    const response = await request.get(`${session.backendUrl}/rest/v1/${table}?id=eq.${id}&select=id,tenant_id`, { headers });
    expect(response.ok(), await response.text()).toBeTruthy();
    expect(await response.json()).toEqual([]);
  }
});

test("auth and fail-closed integration screen have no serious axe violations", async ({ page }) => {
  await page.goto("/auth");
  const authResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(authResults.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);

  await loginThroughUi(page, accounts.operator);
  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Integração em implantação" })).toBeVisible();
  const capabilityResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(capabilityResults.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
});
