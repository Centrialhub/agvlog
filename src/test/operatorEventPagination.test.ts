import { describe, expect, it, vi } from 'vitest';
import {
  parseOperationalEventPage,
  readAllOperationalEventPages,
  type OperationalEventCursor,
} from '@/lib/operationalEvents/operatorEventPagination';

const tenant = '11000000-0000-4000-8000-000000000001';
const actor = '11000000-0000-4000-8000-000000000002';
const otherTenant = '22000000-0000-4000-8000-000000000001';
const scope = 'a'.repeat(64);
const first = {
  id: '11000000-0000-4000-8000-000000000011',
  tenant_id: tenant,
  created_at: '2026-09-01T18:00:00.000Z',
  event_type: 'other',
  severity: 'medium',
};
const second = {
  ...first,
  id: '11000000-0000-4000-8000-000000000012',
  created_at: '2026-09-01T17:00:00.000Z',
};

const page = (items: typeof first[], next: OperationalEventCursor | null, tenantId = tenant) => ({
  version: 1,
  tenant_id: tenantId,
  actor_id: actor,
  items,
  next_cursor: next,
});

describe('operator event cursor pagination', () => {
  it('reads every page and only resolves after the server confirms the end', async () => {
    const cursor = { scope, created_at: first.created_at, id: first.id };
    const read = vi.fn()
      .mockResolvedValueOnce(page([first], cursor))
      .mockResolvedValueOnce(page([second], null));

    await expect(readAllOperationalEventPages(read, tenant, actor)).resolves.toEqual([first, second]);
    expect(read).toHaveBeenNthCalledWith(1, null);
    expect(read).toHaveBeenNthCalledWith(2, cursor);
  });

  it('fails closed when a later page cannot be confirmed', async () => {
    const cursor = { scope, created_at: first.created_at, id: first.id };
    const read = vi.fn()
      .mockResolvedValueOnce(page([first], cursor))
      .mockRejectedValueOnce(new Error('network unavailable'));

    await expect(readAllOperationalEventPages(read, tenant, actor)).rejects.toThrow('network unavailable');
  });

  it('rejects cross-tenant rows even when the page envelope claims the expected tenant', () => {
    expect(() => parseOperationalEventPage(page([{ ...first, tenant_id: otherTenant }], null), tenant, actor))
      .toThrow('outra empresa');
  });

  it('rejects a cursor that does not match the last returned item', () => {
    const incompatible = { scope, created_at: second.created_at, id: second.id };
    expect(() => parseOperationalEventPage(page([first], incompatible), tenant, actor))
      .toThrow('Cursor de ocorrências incompatível');
  });

  it('rejects duplicate rows across pages instead of returning a misleading list', async () => {
    const cursor = { scope, created_at: first.created_at, id: first.id };
    const read = vi.fn()
      .mockResolvedValueOnce(page([first], cursor))
      .mockResolvedValueOnce(page([first], null));

    await expect(readAllOperationalEventPages(read, tenant, actor)).rejects.toThrow('itens duplicados');
  });
});
