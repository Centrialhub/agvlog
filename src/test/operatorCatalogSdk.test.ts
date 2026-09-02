import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readOperatorReferenceCatalog } from '@/lib/operator/operatorReferencePagination';
import { clearOperatorClientPageAnchors, readOperatorClientPageNumber } from '@/lib/operator/operatorClientPagination';

const fixture = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }));
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    // Keep the real SDK methods: a plain rpc mock cannot detect lost `this`.
    supabase: createClient('https://catalog-fixture.invalid', 'fixture-key', {
      accessToken: async () => 'fixture-token',
      global: { fetch: (...args) => fixture.fetch(...args) },
    }),
  };
});

const tenant = '41000000-0000-4000-8000-000000000001';
const actor = '41000000-0000-4000-8000-000000000002';
const snapshot = '2026-09-02T12:00:00+00:00';
const scope = 'a'.repeat(64);
const client = (n: number) => ({
  id: `41000000-0000-4000-8000-${String(n + 10).padStart(12, '0')}`,
  tenant_id: tenant, created_at: '2026-09-01T12:00:00+00:00',
  company_name: `Cliente ${n}`, tax_id: '12345678000190', active: true,
  is_client: true, is_supplier: false, address_street: 'Rua de teste',
  address_city: 'São Paulo', address_city_ibge_code: '3550308',
});

beforeEach(() => { fixture.fetch.mockReset(); clearOperatorClientPageAnchors(); });

describe('operator catalogs through the real Supabase SDK', () => {
  it('requests all 510 clients across two RPC pages and preserves autofill fields', async () => {
    const rows = Array.from({ length: 510 }, (_, n) => client(n));
    fixture.fetch.mockImplementation(async (url, options) => {
      expect(String(url)).toBe('https://catalog-fixture.invalid/rest/v1/rpc/list_operator_reference_page_v1');
      expect(new Headers(options?.headers).get('authorization')).toBe('Bearer fixture-token');
      const args = JSON.parse(String(options?.body));
      expect(args).toMatchObject({ _tenant_id: tenant, _resource: 'clients', _include_inactive: true, _limit: 500 });
      const first = args._cursor === null;
      if (!first) expect(args._cursor.id).toBe(rows[499].id);
      return Response.json({ version: 1, tenant_id: tenant, actor_id: actor, resource: 'clients',
        items: first ? rows.slice(0, 500) : rows.slice(500),
        next_cursor: first ? { scope, snapshot_at: snapshot, created_at: rows[499].created_at, id: rows[499].id } : null,
      });
    });
    const result = await readOperatorReferenceCatalog({ tenantId: tenant, actorId: actor, resource: 'clients', includeInactive: true });
    expect(result).toEqual(rows);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
  });

  it('loads the searchable client page through the SDK instance', async () => {
    fixture.fetch.mockImplementation(async (url, options) => {
      expect(String(url)).toBe('https://catalog-fixture.invalid/rest/v1/rpc/list_operator_clients_page_v1');
      expect(JSON.parse(String(options?.body))).toEqual({
        _tenant_id: tenant, _search: 'Cliente', _kind: 'all', _limit: 50,
        _cursor: null, _direction: 'next', _snapshot_at: null,
      });
      return Response.json({ version: 1, tenant_id: tenant, actor_id: actor, resource: 'clients',
        snapshot_at: snapshot, items: [client(1)], total_count: 1, previous_cursor: null, next_cursor: null,
      });
    });
    const result = await readOperatorClientPageNumber({ tenantId: tenant, actorId: actor, page: 1, pageSize: 50, search: 'Cliente', kind: 'all' });
    expect(result.items).toEqual([client(1)]);
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
  });

  it('propagates a database denial instead of presenting an empty catalog', async () => {
    fixture.fetch.mockResolvedValue(Response.json({ code: '42501', message: 'operator_reference_list_not_authorized' }, { status: 403 }));
    await expect(readOperatorReferenceCatalog({ tenantId: tenant, actorId: actor, resource: 'clients' }))
      .rejects.toMatchObject({ code: '42501', message: 'operator_reference_list_not_authorized' });
  });
});
