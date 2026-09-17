import { beforeEach, expect, it, vi } from 'vitest';
import { readFinanceStatementHistory } from '@/lib/financial/ledgerClient';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));

const tenant = crypto.randomUUID();
const importId = crypto.randomUUID();
const snapshot = '2026-09-17T12:00:00+00:00';

beforeEach(() => rpc.mockReset());

it('returns the server snapshot and sends it unchanged on later pages', async () => {
  rpc.mockResolvedValue({
    data: { version: 1, tenant_id: tenant, import_id: importId, page: 2, page_size: 30, snapshot_at: snapshot, total: 31, rows: [] },
    error: null,
  });

  await expect(readFinanceStatementHistory(tenant, importId, 2, 30, snapshot)).resolves.toMatchObject({ snapshot_at: snapshot });
  expect(rpc).toHaveBeenCalledWith('list_finance_statement_history_v1', {
    _tenant_id: tenant,
    _import_id: importId,
    _page: 2,
    _page_size: 30,
    _snapshot_at: snapshot,
  });
});

it('rejects a response from a different snapshot', async () => {
  rpc.mockResolvedValue({
    data: { version: 1, tenant_id: tenant, import_id: importId, page: 2, page_size: 30, snapshot_at: '2026-09-17T12:01:00+00:00', total: 0, rows: [] },
    error: null,
  });

  await expect(readFinanceStatementHistory(tenant, importId, 2, 30, snapshot)).rejects.toThrow('fora do contexto');
});
