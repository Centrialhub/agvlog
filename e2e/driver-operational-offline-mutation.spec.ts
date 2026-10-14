import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import path from 'node:path';
import type { OperationalOfflineHarness } from './fixtures/driver-operational-offline-mutation';

type HarnessGlobal = typeof globalThis & { driverOperationalOfflineHarness: OperationalOfflineHarness };
let server: ViteDevServer;
let harnessUrl: string;
test.beforeAll(async () => {
  const fixture = path.resolve('e2e/fixtures/driver-operational-offline-mutation.tsx');
  const aliases = ['hooks/useAuth', 'hooks/useTenant', 'hooks/useCurrentDriver', 'hooks/useChecklistStatus',
    'hooks/useDriverJourneyContext', 'hooks/useDriverOperationalEventHistory', 'hooks/use-toast', 'integrations/supabase/client'];
  server = await createServer({
    envDir: process.env.AGVLOG_OFFLINE_TEST_ENV_DIR ?? path.resolve('e2e/fixtures'),
    cacheDir: process.env.AGVLOG_OFFLINE_TEST_CACHE_DIR ?? path.resolve('node_modules/.vite-operational-offline'),
    resolve: { alias: [...aliases.map(id => ({ find: `@/${id}`, replacement: fixture })), { find: '@', replacement: path.resolve('src') }] },
    optimizeDeps: { entries: ['e2e/fixtures/driver-operational-offline-mutation.html'] },
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls?.local[0];
  if (!baseUrl) throw new Error('Vite did not expose the isolated regression URL.');
  harnessUrl = new URL('/e2e/fixtures/driver-operational-offline-mutation.html', baseUrl).href;
});
test.afterAll(async () => { await server?.close(); });
async function submit(page: Page, mode: 'journey' | 'checklist' | 'occurrence') {
  if (mode === 'journey') await page.getByRole('button', { name: 'Almoço' }).click();
  else if (mode === 'checklist') {
    await page.getByRole('checkbox').first().click(); await page.getByRole('button', { name: 'Salvar Pré-Viagem' }).click();
  } else {
    await page.getByRole('button', { name: 'Nova', exact: true }).click();
    await page.getByLabel('Tipo', { exact: true }).click(); await page.getByRole('option', { name: 'Outro', exact: true }).click();
    await page.getByLabel('Descrição', { exact: true }).fill('Ocorrência sintética offline');
    await page.getByRole('button', { name: 'Registrar Ocorrência' }).click();
  }
}
test.describe('actual operational UI / QueryClient / IndexedDB, synthetic transport', () => {
  for (const mode of ['journey', 'checklist', 'occurrence'] as const) {
    test(`${mode}: stores offline, reopens exact row, rejects foreign recovery and replays once`, async ({ page }) => {
      const externalOrigins: string[] = [];
      const harnessOrigin = new URL(harnessUrl).origin;
      await page.route('**/*', async route => {
        const origin = new URL(route.request().url()).origin;
        if (origin === harnessOrigin) await route.continue();
        else { externalOrigins.push(origin); await route.abort(); }
      });
      await page.goto(`${harnessUrl}?mode=${mode}&offline=1`);
      await submit(page, mode);
      await expect.poll(() => page.evaluate(async () => (await (globalThis as HarnessGlobal).driverOperationalOfflineHarness.inspect()).rows.length)).toBe(1);
      const before = await page.evaluate(() => (globalThis as HarnessGlobal).driverOperationalOfflineHarness.inspect());
      expect(before.calls).toEqual([]);
      expect(before.mutations).toEqual([{ status: 'success', isPaused: false }]);
      expect(before.toasts).toEqual([expect.objectContaining({ title: expect.stringContaining('aparelho') })]);
      const [row] = before.rows;
      expect(row).toMatchObject({ kind: mode, state: 'queued', attempts: 0,
        tenantId: '73000000-0000-4000-8000-000000000001', actorId: '73000000-0000-4000-8000-000000000002' });
      // Assets stay reachable for this reload; network state is controlled by the harness.
      // This proves IndexedDB durability independently of the separate PWA shell qualification.
      await page.reload();
      await expect.poll(() => page.evaluate(() => !!(globalThis as HarnessGlobal).driverOperationalOfflineHarness)).toBe(true);
      const reopened = await page.evaluate(() => (globalThis as HarnessGlobal).driverOperationalOfflineHarness.inspect());
      expect(reopened.rows).toEqual(before.rows); expect(reopened.calls).toEqual([]); expect(reopened.mutations).toEqual([]);
      await page.evaluate(() => {
        const h = (globalThis as HarnessGlobal).driverOperationalOfflineHarness;
        h.setContext('73000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000009'); h.setOnline(true);
      });
      await page.waitForTimeout(50);
      await page.evaluate(() => (globalThis as HarnessGlobal).driverOperationalOfflineHarness.recover());
      expect((await page.evaluate(() => (globalThis as HarnessGlobal).driverOperationalOfflineHarness.inspect())).calls).toEqual([]);
      await page.evaluate(() => (globalThis as HarnessGlobal).driverOperationalOfflineHarness.setContext(
        '73000000-0000-4000-8000-000000000010', '73000000-0000-4000-8000-000000000002'));
      await page.waitForTimeout(50);
      await page.evaluate(() => (globalThis as HarnessGlobal).driverOperationalOfflineHarness.recover());
      expect((await page.evaluate(() => (globalThis as HarnessGlobal).driverOperationalOfflineHarness.inspect())).calls).toEqual([]);
      await page.evaluate(() => (globalThis as HarnessGlobal).driverOperationalOfflineHarness.setContext(
        '73000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000002'));
      await page.waitForTimeout(50);
      await page.evaluate(() => (globalThis as HarnessGlobal).driverOperationalOfflineHarness.recover());
      const confirmed = await page.evaluate(() => (globalThis as HarnessGlobal).driverOperationalOfflineHarness.inspect());
      expect(confirmed.rows).toEqual([]);
      expect(confirmed.calls).toEqual([{ name: 'driver_apply_offline_command_v1', args: {
        _tenant_id: row.tenantId, _request_id: row.id, _command: mode === 'journey' ? 'journey_event' : mode, _payload: row.payload,
      } }]);
      await page.evaluate(() => (globalThis as HarnessGlobal).driverOperationalOfflineHarness.recover());
      expect((await page.evaluate(() => (globalThis as HarnessGlobal).driverOperationalOfflineHarness.inspect())).calls).toEqual(confirmed.calls);
      expect(externalOrigins).toEqual([]);
      await test.info().attach('durable-offline-proof', { contentType: 'application/json',
        body: JSON.stringify({ at: new Date().toISOString(), mode, harnessOrigin, externalOrigins,
          networkStateControlledByHarness: true, transport: 'synthetic', before, reopened, confirmed }, null, 2) });
    });
  }
});
