import { expect, test } from "@playwright/test";

import { accounts } from "./fixtures/accounts";
import { loginThroughUi } from "./fixtures/session";

test("@critical core launch routes render without a fatal browser error", async ({ page }) => {
  const uncaught: string[] = [];
  page.on("pageerror", (error) => uncaught.push(error.message));

  await loginThroughUi(page, accounts.operator);
  for (const route of ["/loads", "/clients", "/route-planning", "/drivers", "/vehicles"]) {
    await page.goto(route);
    await expect(page.locator("body")).not.toContainText("Algo deu errado");
    await expect(page.locator("main, [role=main]").first()).toBeVisible({ timeout: 20_000 });
  }

  expect(uncaught).toEqual([]);
});
