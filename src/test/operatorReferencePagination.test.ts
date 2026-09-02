import { describe, expect, it, vi } from 'vitest';
import {
  parseOperatorReferencePage,
  readAllOperatorReferencePages,
  type OperatorReferenceCursor,
} from '@/lib/operator/operatorReferencePagination';

const tenant = '41000000-0000-4000-8000-000000000001';
const actor = '41000000-0000-4000-8000-000000000002';
const scope = 'a'.repeat(64);
const first = {
  id: '41000000-0000-4000-8000-000000000011',
  tenant_id: tenant,
  created_at: '2026-09-01T18:00:00.000Z',
  load_number: 'LOAD-1',
};
const second = {
  ...first,
  id: '41000000-0000-4000-8000-000000000012',
  created_at: '2026-09-01T17:00:00.000Z',
  load_number: 'LOAD-2',
};
const cursor: OperatorReferenceCursor = {
  scope,
  snapshot_at: '2026-09-01T19:00:00.000Z',
  created_at: first.created_at,
  id: first.id,
};
const page = (items: typeof first[], next: OperatorReferenceCursor | null) => ({
  version: 1,
  tenant_id: tenant,
  actor_id: actor,
  resource: 'loads',
  items,
  next_cursor: next,
});

describe('operator reference cursor pagination', () => {
  it('reads until an explicit server end and does not truncate later pages', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(page([first], cursor))
      .mockResolvedValueOnce(page([second], null));
    await expect(readAllOperatorReferencePages(read, tenant, actor, 'loads'))
      .resolves.toEqual([first, second]);
    expect(read.mock.calls).toEqual([[null], [cursor]]);
  });

  it('fails closed on a later read error or incompatible envelope', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(page([first], cursor))
      .mockRejectedValueOnce(new Error('network unavailable'));
    await expect(readAllOperatorReferencePages(read, tenant, actor, 'loads'))
      .rejects.toThrow('network unavailable');
    expect(() => parseOperatorReferencePage({ ...page([first], null), actor_id: first.id }, tenant, actor, 'loads'))
      .toThrow('sessão atual');
    expect(() => parseOperatorReferencePage({ ...page([first], null), resource: 'clients' }, tenant, actor, 'loads'))
      .toThrow('sessão atual');
  });

  it('rejects cross-tenant, duplicate and non-advancing results', async () => {
    expect(() => parseOperatorReferencePage(page([{ ...first, tenant_id: actor }], null), tenant, actor, 'loads'))
      .toThrow('outra empresa');
    await expect(readAllOperatorReferencePages(
      vi.fn().mockResolvedValueOnce(page([first], cursor)).mockResolvedValueOnce(page([first], null)),
      tenant,
      actor,
      'loads',
    )).rejects.toThrow('duplicados');
    const other = { ...second, id: first.id, created_at: first.created_at };
    await expect(readAllOperatorReferencePages(
      vi.fn().mockResolvedValue(page([other], cursor)),
      tenant,
      actor,
      'loads',
    )).rejects.toThrow(/duplicados|não avançou/);
  });
});
