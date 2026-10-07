import { expect, test, type APIRequestContext } from "@playwright/test";

import { accounts, fixtureIds } from "./fixtures/accounts";
import { loginThroughUi, passwordToken } from "./fixtures/session";

async function expectPrivilegedTenantBoundary(request: APIRequestContext, account: typeof accounts.owner | typeof accounts.admin) {
  const session = await passwordToken(request, account);
  const headers = { apikey: session.publishableKey, Authorization: `Bearer ${session.accessToken}` };
  const ownClient = await request.get(
    `${session.backendUrl}/rest/v1/clients?id=eq.${fixtureIds.clientA}&select=id,tenant_id`,
    { headers },
  );
  expect(ownClient.ok(), await ownClient.text()).toBeTruthy();
  expect(await ownClient.json()).toEqual([{ id: fixtureIds.clientA, tenant_id: fixtureIds.tenantA }]);

  const otherTenantClient = await request.get(
    `${session.backendUrl}/rest/v1/clients?id=eq.${fixtureIds.clientB}&select=id,tenant_id`,
    { headers },
  );
  expect(otherTenantClient.ok(), await otherTenantClient.text()).toBeTruthy();
  expect(await otherTenantClient.json()).toEqual([]);
}

test("@critical public auth is invite-only and protected routes redirect", async ({ page }) => {
  await page.goto("/loads");
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await expect(page.getByText("O acesso é criado por convite do administrador da sua empresa.")).toBeVisible();
  await expect(page.getByRole("button", { name: /cadastrar|criar conta/i })).toHaveCount(0);
});

test("@critical operator reaches the internal operations center", async ({ page }) => {
  await loginThroughUi(page, accounts.operator);
  await expect(page.getByRole("heading", { name: /operator/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Cargas", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /operator/i })).toBeVisible({ timeout: 20_000 });
});

test("@critical driver is routed to the driver workspace", async ({ page }) => {
  await loginThroughUi(page, accounts.driver);
  await expect(page).toHaveURL(/\/driver$/);
  await expect(page.getByRole("heading", { name: /Motorista E2E A/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Cargas atribuídas/)).toBeVisible();
});

test("@critical client is routed to its scoped portal", async ({ page }) => {
  await loginThroughUi(page, accounts.client);
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Em trânsito", { exact: true })).toBeVisible();
});

test("@critical owner signs in with password and retains tenant-scoped management access", async ({ page, request }) => {
  await loginThroughUi(page, accounts.owner);
  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Novo Pedido" })).toBeVisible();
  await expectPrivilegedTenantBoundary(request, accounts.owner);
});

test("@critical admin signs in with password and retains tenant-scoped management access", async ({ page, request }) => {
  await loginThroughUi(page, accounts.admin);
  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Novo Pedido" })).toBeVisible();
  await expectPrivilegedTenantBoundary(request, accounts.admin);
});

test("multi-tenant operator can switch tenant without gaining a new role", async ({ page }, testInfo) => {
  await loginThroughUi(page, accounts.multiOperator);
  let switchedAccessToken: string | null = null;
  let targetTenant: string = fixtureIds.tenantB;
  page.on("response", async response => {
    if (!response.url().includes("/auth/v1/token?grant_type=refresh_token") || !response.ok()) return;
    const payload = await response.json().catch(() => null) as { access_token?: string } | null;
    if (!payload?.access_token) return;
    const claims = JSON.parse(Buffer.from(payload.access_token.split(".")[1], "base64url").toString()) as { active_tenant_id?: string };
    if (claims.active_tenant_id === targetTenant) switchedAccessToken = payload.access_token;
  });
  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("button", { name: "Abrir menu principal" }).click();
  }
  const switcher = page.getByLabel("Empresa ativa").filter({ visible: true });
  await expect(switcher).toBeVisible();
  targetTenant = await switcher.inputValue() === fixtureIds.tenantB ? fixtureIds.tenantA : fixtureIds.tenantB;
  await switcher.selectOption(targetTenant);
  await expect.poll(() => Boolean(switchedAccessToken)).toBe(true);
  // The mobile selector closes its sheet on change. Reopen it to verify the
  // completed transition, retaining the signed-claim and API role assertions.
  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("button", { name: "Abrir menu principal" }).click();
  }
  await expect(switcher).toHaveValue(targetTenant);
  const memberships = await page.request.post(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/get_current_memberships_v1`, {
    headers: { apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, Authorization: `Bearer ${switchedAccessToken}`,
      "x-agvlog-tenant-id": targetTenant }, data: {},
  });
  expect(memberships.ok()).toBeTruthy();
  expect(await memberships.json()).toEqual(expect.arrayContaining([
    expect.objectContaining({ tenant_id: targetTenant, role: "operator" }),
  ]));
});

test("logout clears the authenticated route", async ({ page }, testInfo) => {
  await loginThroughUi(page, accounts.operator);
  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("button", { name: "Abrir menu principal" }).click();
  }
  await page.getByRole("button", { name: testInfo.project.name.startsWith("mobile") ? "Sair" : "Sair da conta", exact: true })
    .filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/auth$/);
});
