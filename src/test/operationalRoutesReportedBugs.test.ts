import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { settleInBatches } from '@/lib/controlTower/batchRouteCalculation';
import { cloneRouteDestinations, parseOperationalRouteCatalog } from '@/hooks/useOperationalRoutes';

const tenantId = '20000000-0000-4000-8000-000000000001';
const pageSource = readFileSync('src/pages/OperationalRoutesPage.tsx', 'utf8');
const towerMigration = readFileSync(
  'supabase/migrations/20260917132000_make_control_tower_reader_catalog_compatible.sql',
  'utf8',
);
const towerRevisionMigration = readFileSync(
  'supabase/migrations/20260917143500_restore_control_tower_revision_guards.sql',
  'utf8',
);
const settlementMigration = readFileSync(
  'supabase/migrations/20260917132500_expand_driver_settlement_filter_options.sql',
  'utf8',
);
const routeDeleteMigration = readFileSync(
  'supabase/migrations/20260917135000_allow_operator_delete_operational_routes.sql',
  'utf8',
);
const routeDeleteCasMigration = readFileSync(
  'supabase/migrations/20260917135100_delete_operational_route_cas.sql',
  'utf8',
);
const routeDeleteAuditMigration = readFileSync(
  'supabase/migrations/20260917135200_audit_operational_route_delete.sql',
  'utf8',
);
const routeHookSource = readFileSync('src/hooks/useOperationalRoutes.tsx', 'utf8');

function route(id: string, destinations: unknown) {
  return {
    id,
    tenant_id: tenantId,
    created_at: '2026-09-17T00:00:00.000Z',
    updated_at: '2026-09-17T00:00:00.000Z',
    created_by: null,
    updated_by: null,
    name: `Rota ${id.at(-1)}`,
    description: null,
    classification: 'general',
    region_name: null,
    periodicity_default: null,
    active: false,
    destinations,
  };
}

describe('reported operational route and settlement regressions', () => {
  it('keeps stop coordinates in the Control Tower live contract', () => {
    expect(towerMigration).toContain('dispatch_stop.latitude');
    expect(towerMigration).toContain('dispatch_stop.longitude');
  });

  it('rejects live geometry, metrics and automatic alerts from an obsolete trip plan', () => {
    expect(towerRevisionMigration).toContain('control_tower_private.context_revision');
    expect(towerRevisionMigration).toContain('control_tower_private.route_plan_revision');
    expect(towerRevisionMigration).toContain("alert.metadata ->> 'context_revision'");
  });

  it('distinguishes route query failure from a successful empty catalog', () => {
    expect(pageSource).toContain('isError ? (');
    expect(pageSource).toContain('Não foi possível consultar as rotas');
    expect(pageSource).toContain('Tentar novamente');
    expect(pageSource).toContain('disabled={isError}');
  });

  it('preserves per-destination periodicity and weekdays through editing', () => {
    const source = [{ name: 'Belo Horizonte', periodicity: 'weekly' as const, weekdays: [1, 3, 5], note: 'QA' }];
    const cloned = cloneRouteDestinations(source);
    expect(cloned).toEqual(source);
    expect(cloned).not.toBe(source);
    expect(cloned[0]).not.toBe(source[0]);
    expect(typeof cloned[0] === 'string' ? null : cloned[0].weekdays).not.toBe(source[0].weekdays);
  });

  it('isolates malformed legacy routes while retaining valid rows and metadata', () => {
    const catalog = parseOperationalRouteCatalog([
      route('20000000-0000-4000-8000-000000000011', [
        { name: 'Contagem', periodicity: 'biweekly', weekdays: [2, 4] },
      ]),
      route('20000000-0000-4000-8000-000000000012', { name: 'not-an-array' }),
    ], tenantId);
    expect(catalog).toHaveLength(1);
    expect(catalog.invalidCount).toBe(1);
    expect(catalog.invalidRoutes).toHaveLength(1);
    expect(catalog.invalidRoutes[0]).toMatchObject({
      id: '20000000-0000-4000-8000-000000000012',
      name: 'Rota 2',
      destinations: [{ name: 'not-an-array' }],
    });
    expect(pageSource).toContain('invalidRouteCount > 0');
    expect(pageSource).toContain('Corrigir');
    expect(pageSource).toContain('deactivateInvalidRoute');
    expect(pageSource).toContain('Excluir esta rota incompatível?');
    expect(catalog[0].destinations).toEqual([
      { name: 'Contagem', periodicity: 'biweekly', weekdays: [2, 4] },
    ]);
  });

  it('calculates routes in bounded batches with a pause between batches', async () => {
    let active = 0;
    let maximum = 0;
    const pauses: number[] = [];
    const results = await settleInBatches([1, 2, 3, 4, 5], 2, 400, async value => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return value * 2;
    }, async milliseconds => { pauses.push(milliseconds); });
    expect(maximum).toBe(2);
    expect(pauses).toEqual([400, 400]);
    expect(results).toHaveLength(5);
    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
  });

  it('includes active drivers without settlements in manual-settlement options', () => {
    expect(settlementMigration).toContain('driver.active');
    expect(settlementMigration).toContain('from public.driver_settlements settlement');
    expect(settlementMigration).not.toContain('AND EXISTS (SELECT 1 FROM public.driver_settlements');
  });

  it('routes operator deletion through a revision-checked command', () => {
    expect(routeDeleteMigration).toContain('for delete');
    expect(routeDeleteCasMigration).toContain('revoke delete on table public.operational_routes from authenticated');
    expect(routeDeleteCasMigration).toContain('operational_route_changed');
    expect(routeHookSource).toContain("supabase.rpc('delete_operational_route_v1'");
    expect(routeHookSource).toContain('_expected_updated_at: expectedUpdatedAt');
    expect(pageSource).toContain('expectedUpdatedAt: r.updated_at');
    expect(pageSource).toContain('expectedUpdatedAt: route.updated_at');
  });

  it('uses the route revision to reject stale concurrent updates', () => {
    expect(routeHookSource).toContain(".eq('updated_at', expectedUpdatedAt)");
    expect(routeHookSource).toContain('Esta rota foi alterada por outra pessoa.');
    expect(pageSource).toContain('expectedUpdatedAt: editingRevision');
    expect(pageSource).toContain('setEditingRevision(r.updated_at)');
  });

  it('preserves the complete deleted route in the central audit log', () => {
    expect(routeDeleteAuditMigration).toContain('v_route public.operational_routes%rowtype');
    expect(routeDeleteAuditMigration).toContain("'operational_route'");
    expect(routeDeleteAuditMigration).toContain('to_jsonb(v_route)');
    expect(routeDeleteAuditMigration).toContain("'delete_operational_route_v1'");
  });
});
