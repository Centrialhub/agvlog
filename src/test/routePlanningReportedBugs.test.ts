import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCustomerWindowsForDate } from '@/lib/route-planning/autoRoutePlanner';
import { areAllVisibleLoadsSelected, toggleVisibleLoadSelection } from '@/lib/route-planning/routePlanningLoads';
import type { RouteStopDraft } from '@/lib/route-planning/routePlanningTypes';

const pageSource = readFileSync('src/pages/RoutePlanning.tsx', 'utf8');
const loadsHookSource = readFileSync('src/hooks/route-planning/usePendingLoadsForRouting.ts', 'utf8');

describe('reported route planning regressions', () => {
  it('keeps query failures distinct from an empty pending-load queue', () => {
    expect(pageSource).toContain('pendingLoadsQuery.isError');
    expect(pageSource).toContain('pendingLoadsQuery.refetch()');
    expect(pageSource).toMatch(/pendingLoadsQuery\.isError[\s\S]*?: availableLoads\.length === 0/);
  });

  it('fetches all loads and items in bounded PostgREST pages and filters chunks', () => {
    expect(loadsHookSource.match(/fetchAllPostgrestPages/g)?.length).toBeGreaterThanOrEqual(2);
    expect(loadsHookSource).toContain('IN_FILTER_CHUNK');
    expect(loadsHookSource).toContain('loadIds.slice(index, index + IN_FILTER_CHUNK)');
    expect(loadsHookSource).toContain('clientIds.slice(index, index + IN_FILTER_CHUNK)');
  });

  it('uses the location-aware pending-load hook instead of a local text-only query', () => {
    expect(pageSource).toContain('usePendingLoadsForRouting()');
    expect(loadsHookSource).toContain("'get_routing_client_locations_v1'");
    expect(loadsHookSource).toContain('client_location:');
  });

  it('waits for both remote queries before finalizing draft hydration', () => {
    expect(pageSource).toContain('!pendingLoadsQuery.isSuccess || !draftsQuery.isSuccess');
    expect(pageSource).toContain('draftsQuery.isError');
    expect(pageSource).toContain('draftsQuery.refetch()');
  });

  it('locks the batch synchronously and exposes its busy state', () => {
    expect(pageSource).toContain('if (batchDispatchLockRef.current) return');
    expect(pageSource).toContain('batchDispatchLockRef.current = true');
    expect(pageSource).toContain('batchDispatchLockRef.current = false');
    expect(pageSource).toContain('|| batchBusy');
  });

  it('removes a confirmed individual dispatch locally without deleting the consumed draft again', () => {
    const successBlock = pageSource.match(/onSuccess: \(_, route\) => \{[\s\S]*?\n {4}\},/)?.[0] ?? '';
    expect(successBlock).toContain('setRoutes(previous => previous.filter');
    expect(successBlock).toContain('savePlanSnapshot.forgetVersion(route.id)');
    expect(successBlock).not.toContain('removeRoute(route.id)');
  });

  it('applies only the delivery window configured for the local weekday of the route', () => {
    const stop = {
      id: 'stop', client_id: 'client', recipient_name: 'Cliente', destination: 'Destino', load_ids: [],
      fiscal_document_ids: [], invoice_numbers: [], total_weight_kg: 0, total_volume_m3: 0,
      total_pallet_count: 0, total_value: 0, service_time_minutes: 10, priority: 0, risk_level: 'normal',
    } satisfies RouteStopDraft;
    const [result] = applyCustomerWindowsForDate([stop], [
      { client_id: 'client', weekday: 1, start_time: '08:00', end_time: '10:00' },
      { client_id: 'client', weekday: 2, start_time: '14:00', end_time: '16:00' },
    ], '2026-09-14T07:30');
    expect(result).toMatchObject({ delivery_window_start: '08:00', delivery_window_end: '10:00' });
  });

  it('selects and clears only the currently visible load ids', () => {
    const selected = new Set(['hidden', 'old-visible']);
    expect(areAllVisibleLoadsSelected(selected, ['new-visible'])).toBe(false);
    const added = toggleVisibleLoadSelection(selected, ['new-visible']);
    expect([...added].sort()).toEqual(['hidden', 'new-visible', 'old-visible']);
    const cleared = toggleVisibleLoadSelection(added, ['new-visible']);
    expect([...cleared].sort()).toEqual(['hidden', 'old-visible']);
  });
});
