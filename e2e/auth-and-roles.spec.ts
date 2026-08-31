import { expect, test } from "@playwright/test";

import { accounts } from "./fixtures/accounts";
import { loginThroughUi } from "./fixtures/session";

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

test("owner is stopped at MFA enrollment before tenant data renders", async ({ page }) => {
  await loginThroughUi(page, accounts.owner);
  await expect(page.getByRole("heading", { name: "Verificação em duas etapas" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Escaneie o QR code|aplicativo autenticador/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cargas" })).toHaveCount(0);
});

test("admin is stopped at the same mandatory MFA boundary", async ({ page }) => {
  await loginThroughUi(page, accounts.admin);
  await expect(page.getByRole("heading", { name: "Verificação em duas etapas" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Código de 6 dígitos")).toBeVisible();
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
