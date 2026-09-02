import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc } }));

import {
  clearOperatorClientPageAnchors,
  parseOperatorClientPage,
  readOperatorClientPageNumber,
} from '@/lib/operator/operatorClientPagination';

const tenant = '44000000-0000-4000-8000-000000000001';
const actor = '44000000-0000-4000-8000-000000000002';
const snapshot = '2026-09-01T20:00:00.000Z';
const scope = 'c'.repeat(64);
const clients = Array.from({ length: 5 }, (_, index) => ({
  id: `44000000-0000-4000-8000-${String(index + 11).padStart(12, '0')}`,
  tenant_id: tenant,
  company_name: `Cliente ${index + 1}`,
  created_at: `2026-09-01T1${index}:00:00.000Z`,
  active: true,
}));
const cursor = (index: number) => ({
  scope,
  snapshot_at: snapshot,
  company_name: clients[index].company_name,
  id: clients[index].id,
});

function page(items: typeof clients, previous: ReturnType<typeof cursor> | null, next: ReturnType<typeof cursor> | null) {
  return {
    version: 1,
    tenant_id: tenant,
    actor_id: actor,
    resource: 'clients',
    snapshot_at: snapshot,
    items,
    total_count: 5,
    previous_cursor: previous,
    next_cursor: next,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearOperatorClientPageAnchors();
  mock.rpc.mockImplementation((_name: string, args: {
    _cursor: ReturnType<typeof cursor> | null;
    _direction: 'next' | 'previous';
  }) => {
    if (args._direction === 'previous' && args._cursor === null) {
      return Promise.resolve({ data: page([clients[4]], cursor(4), null), error: null });
    }
    if (args._direction === 'previous' && args._cursor?.id === clients[4].id) {
      return Promise.resolve({ data: page(clients.slice(2, 4), cursor(2), cursor(3)), error: null });
    }
    if (args._cursor?.id === clients[1].id) {
      return Promise.resolve({ data: page(clients.slice(2, 4), cursor(2), cursor(3)), error: null });
    }
    if (args._cursor?.id === clients[3].id) {
      return Promise.resolve({ data: page([clients[4]], cursor(4), null), error: null });
    }
    return Promise.resolve({ data: page(clients.slice(0, 2), null, cursor(1)), error: null });
  });
});

describe('operator client keyset pagination', () => {
  const input = { tenantId: tenant, actorId: actor, pageSize: 2, search: '', kind: 'all' as const };

  it('moves between numbered UI pages using cached keyset anchors', async () => {
    await expect(readOperatorClientPageNumber({ ...input, page: 1 }))
      .resolves.toMatchObject({ items: [clients[0], clients[1]], total_count: 5 });
    await expect(readOperatorClientPageNumber({ ...input, page: 2 }))
      .resolves.toMatchObject({ items: [clients[2], clients[3]] });
    await expect(readOperatorClientPageNumber({ ...input, page: 3 }))
      .resolves.toMatchObject({ items: [clients[4]] });

    expect(mock.rpc).toHaveBeenCalledTimes(3);
    expect(mock.rpc.mock.calls.map(([, args]) => [args._direction, args._cursor?.id ?? null]))
      .toEqual([
        ['next', null],
        ['next', clients[1].id],
        ['previous', null],
      ]);
  });

  it('rejects a page envelope from another authenticated actor', () => {
    expect(() => parseOperatorClientPage({ ...page(clients.slice(0, 2), null, cursor(1)), actor_id: clients[0].id }, tenant, actor))
      .toThrow('sessão atual');
  });
});
