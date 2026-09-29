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
  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("button", { name: "Abrir menu principal" }).click();
  }
  const switcher = page.getByLabel("Empresa ativa").filter({ visible: true });
  await expect(switcher).toBeVisible();
  await switcher.selectOption("20000000-0000-4000-8000-000000000002");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("agvlog_tenant_id")))
    .toBe("20000000-0000-4000-8000-000000000002");
});

test("logout clears the authenticated route", async ({ page }, testInfo) => {
  await loginThroughUi(page, accounts.operator);
  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("button", { name: "Abrir menu principal" }).click();
  }
  await page.getByRole("button", { name: "Sair", exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/auth$/);
});
