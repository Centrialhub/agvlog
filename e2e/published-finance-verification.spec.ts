import { expect, test } from '@playwright/test';

const liveEmail = process.env.LIVE_TEST_EMAIL ?? '';
const livePassword = process.env.LIVE_TEST_PASSWORD ?? '';

test('published financial workspace supports cost center creation and critical navigation', async ({ page }) => {
  test.skip(!liveEmail || !livePassword, 'Credenciais de verificação publicada não informadas.');
  test.setTimeout(120_000);

  const testCostCenter = `QA Codex v46 ${Date.now()}`;
  const serverFailures: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 500) serverFailures.push(`${response.status()} ${response.url()}`);
  });

  await page.goto('/auth');
  await page.getByLabel('Email').fill(liveEmail);
  await page.getByLabel('Senha', { exact: true }).fill(livePassword);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/auth(?:\?|$)/, { timeout: 20_000 });

  await page.goto('/cost-centers');
  await expect(page.getByRole('heading', { name: 'Centros de custo', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Gerenciar centros' }).click();
  await page.getByRole('button', { name: 'Novo centro de custo' }).click();
  await page.getByLabel('Nome do centro de custo').fill(testCostCenter);
  await page.getByRole('button', { name: 'Salvar centro de custo' }).click();
  await expect(page.getByRole('cell', { name: testCostCenter, exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: `Excluir ${testCostCenter}` })).toBeVisible();
  console.log(`CREATED_COST_CENTER=${testCostCenter}`);

  const routes = [
    ['/financial', 'Financeiro'],
    ['/payables', 'Contas a pagar'],
    ['/bank-reconciliation', 'Conciliação bancária'],
    ['/driver-settlements', 'Acertos de motoristas'],
    ['/closing-reports', 'Relatórios de fechamento'],
    ['/billing-edi', 'Faturamento e EDI'],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: new RegExp(`^${heading}$`, 'i') })).toBeVisible({ timeout: 20_000 });
  }

  expect(serverFailures, 'A navegação publicada não deve produzir respostas 5xx').toEqual([]);
});
