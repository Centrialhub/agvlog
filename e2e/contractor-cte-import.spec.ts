import { expect, test } from '@playwright/test';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { accounts, fixtureIds } from './fixtures/accounts';
import { loginThroughUi, passwordToken } from './fixtures/session';
import { calculateNfeAccessKeyCheckDigit } from '../src/lib/fiscalDocuments/nfeAccessKey';

for (const format of ['pdf', 'xml'] as const) {
test(`@critical imports a ${format} CT-e durably, repeats concurrently and isolates the original`, async ({ page, request }) => {
  const own = await passwordToken(request, accounts.operator);
  const other = await passwordToken(request, accounts.tenantB);
  const driver = await passwordToken(request, accounts.driver);
  expect(new URL(own.backendUrl).hostname).toBe('127.0.0.1');
  const service = process.env.E2E_LOCAL_STORAGE_SERVICE_KEY;
  if (!service) throw new Error('An isolated Storage cleanup credential is required.');
  const number = String(randomInt(100000000, 999999999));
  const base = `3126111234567800019557001${number}100000001`;
  expect(base).toHaveLength(43);
  const key = base + calculateNfeAccessKeyCheckDigit(base);
  const bytes = format === 'pdf'
    ? Buffer.from(`%PDF-1.4\n% QA ${randomUUID()}\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`)
    : Buffer.from(`<CTe xmlns="http://www.portalfiscal.inf.br/cte"><infCte Id="CTe${key}" versao="4.00"><ide><mod>57</mod><tpAmb>1</tpAmb><nCT>${number}</nCT><serie>1</serie><dhEmi>2026-11-03T10:00:00-03:00</dhEmi><cMunIni>3143302</cMunIni><cMunFim>3550308</cMunFim></ide><emit><CNPJ>12345678000195</CNPJ><IE>123456789</IE><xNome>Transportadora sintética QA</xNome><enderEmit><xLgr>Rua QA</xLgr><nro>1</nro><xBairro>Centro</xBairro><xMun>Montes Claros</xMun><cMun>3143302</cMun><UF>MG</UF><CEP>39400000</CEP></enderEmit></emit></infCte></CTe>`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const actor = JSON.parse(Buffer.from(own.accessToken.split('.')[1], 'base64url').toString()).sub as string;
  const path = `${fixtureIds.tenantA}/${actor}/${hash}.${format}`;
  const headers = (session: typeof own, tenant: string) => ({ apikey: session.publishableKey, Authorization: `Bearer ${session.accessToken}`, 'x-agvlog-tenant-id': tenant });
  const admin = { apikey: own.publishableKey, Authorization: `Bearer ${service}` };
  let sourceId: string | null = null;
  try {
    await loginThroughUi(page, accounts.operator);
    await page.goto('/ingestion');
    await page.getByRole('tab', { name: 'CT-e da contratante' }).click();
    await page.getByLabel('Selecionar XML ou PDF/DACTE do CT-e').setInputFiles({ name: `original-qa.${format}`, mimeType: format === 'pdf' ? 'application/pdf' : 'application/xml', buffer: bytes });
    if (format === 'pdf') {
    await page.getByLabel('Chave de acesso do CT-e').fill(key);
    for (const [label, value] of [
      ['Razão social da transportadora contratante', 'Transportadora sintética QA'], ['Inscrição estadual da contratante', '123456789'],
      ['UF da contratante', 'MG'], ['Código IBGE de início da prestação', '3143302'], ['Código IBGE de término da prestação', '3550308'],
      ['Data de emissão', '2026-11-03'], ['Logradouro da contratante', 'Rua QA'], ['Número do endereço', '1'], ['Bairro', 'Centro'],
      ['Município da contratante', 'Montes Claros'], ['Código IBGE do município da contratante', '3143302'], ['CEP', '39400000'],
    ]) await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel('Ambiente do documento').selectOption('production');
    await expect(page.getByRole('button', { name: 'Importar CT-e de origem' })).toBeDisabled();
    await page.getByLabel('Conferi os dados com o PDF/DACTE original.').check();
    } else {
      await expect(page.getByLabel('Chave de acesso do CT-e')).toHaveValue(key);
      await expect(page.getByLabel('CNPJ da contratante')).toHaveValue('12345678000195');
    }
    const registration = page.waitForRequest(req => req.url().includes('/rpc/register_contractor_cte_source_v1'));
    await page.getByRole('button', { name: 'Importar CT-e de origem' }).click();
    const payload = (await registration).postDataJSON();
    await expect(page.getByText('CT-e de origem importado com sucesso.')).toBeVisible();
    const concurrent = await Promise.all([1, 2].map(() => request.post(`${own.backendUrl}/rest/v1/rpc/register_contractor_cte_source_v1`, {
      headers: headers(own, fixtureIds.tenantA), data: payload,
    })));
    for (const result of concurrent) expect(result.ok(), await result.text()).toBeTruthy();
    sourceId = await concurrent[0].json() as string;
    expect(await concurrent[1].json()).toBe(sourceId);
    const rows = await request.get(`${own.backendUrl}/rest/v1/contractor_cte_sources?select=id,original_path&access_key=eq.${key}`, { headers: headers(own, fixtureIds.tenantA) });
    expect(await rows.json()).toEqual([{ id: sourceId, original_path: path }]);
    await page.reload();
    await page.getByRole('tab', { name: 'CT-e da contratante' }).click();
    await page.getByLabel('Buscar pela chave de acesso').fill(key);
    await expect(page.getByText(key, { exact: true })).toBeVisible();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar original' }).click();
    const downloadedPath = await (await downloaded).path();
    expect(downloadedPath).not.toBeNull();
    expect(await readFile(downloadedPath!)).toEqual(bytes);
    const cross = await request.get(`${own.backendUrl}/rest/v1/contractor_cte_sources?select=id&access_key=eq.${key}`, { headers: headers(other, fixtureIds.tenantB) });
    expect(await cross.json()).toEqual([]);
    const readOther = await request.get(`${own.backendUrl}/storage/v1/object/authenticated/contractor-cte-originals/${path}`, { headers: headers(other, fixtureIds.tenantB) });
    expect(readOther.ok()).toBeFalsy();
    const forbidden = await request.post(`${own.backendUrl}/rest/v1/rpc/register_contractor_cte_source_v1`, { headers: headers(driver, fixtureIds.tenantA), data: payload });
    expect(forbidden.ok()).toBeFalsy();
    expect((await forbidden.json()).code).toBe('42501');
    const conflict = await request.post(`${own.backendUrl}/rest/v1/rpc/register_contractor_cte_source_v1`, {
      headers: headers(own, fixtureIds.tenantA), data: { ...payload, _document: { ...payload._document, issuer_name: 'Conflito sintético' } },
    });
    expect(conflict.ok()).toBeFalsy(); expect((await conflict.json()).code).toBe('23505');
  } finally {
    // Only the uniquely named synthetic fixture in the guarded localhost stack.
    const removed = await request.delete(`${own.backendUrl}/rest/v1/contractor_cte_sources?tenant_id=eq.${fixtureIds.tenantA}&access_key=eq.${key}`, { headers: { ...admin, Prefer: 'return=representation' } });
    expect(removed.ok()).toBeTruthy();
    if (sourceId) expect((await removed.json())).toHaveLength(1);
    const file = await request.delete(`${own.backendUrl}/storage/v1/object/contractor-cte-originals`, { headers: admin, data: { prefixes: [path] } });
    expect(file.ok()).toBeTruthy();
  }
});
}
