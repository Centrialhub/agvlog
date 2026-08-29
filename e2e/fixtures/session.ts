import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { type accounts } from "./accounts";

type Account = (typeof accounts)[keyof typeof accounts];

function assertE2ePassword(account: Account) {
  if (!account.password) {
    throw new Error("E2E_PASSWORD must be supplied by the isolated CI or staging environment.");
  }
}

export async function loginThroughUi(page: Page, account: Account) {
  assertE2ePassword(account);
  await page.goto("/auth");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Senha").fill(account.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/auth(?:\?|$)/, { timeout: 20_000 });
}

export async function passwordToken(request: APIRequestContext, account: Account) {
  assertE2ePassword(account);
  const backendUrl = process.env.VITE_SUPABASE_URL;
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!backendUrl || !publishableKey) throw new Error("Missing local Supabase E2E environment.");

  const response = await request.post(`${backendUrl}/auth/v1/token?grant_type=password`, {
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    data: account,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const payload = await response.json() as { access_token: string };
  return { backendUrl, publishableKey, accessToken: payload.access_token };
}
