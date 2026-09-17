import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertReallocationCapacity } from '@/lib/loads/reallocationCapacity';
import { compositionMutationError } from '@/lib/loads/compositionMutation';

const pageSource = readFileSync('src/pages/LoadReallocation.tsx', 'utf8');
const migrationSource = readFileSync('supabase/migrations/20260917123500_guard_reallocation_vehicle_capacity.sql', 'utf8');
const cleanupMigrationSource = readFileSync('supabase/migrations/20260917124000_cleanup_empty_source_after_reallocation.sql', 'utf8');

describe('reported load reallocation regressions', () => {
  it('blocks partial data and gives every failed read an explicit retry path', () => {
    expect(pageSource).toContain('loadsQuery.isError');
    expect(pageSource).toContain('vehiclesQuery.isError');
    expect(pageSource).toContain('sourceItemsQuery.isError');
    expect(pageSource).toContain('targetItemsQuery.isError');
    expect(pageSource).toContain('loadMetaQuery.isError');
    expect(pageSource).toContain('Tentar novamente');
  });

  it('reads every metadata row with bounded pages and load-id chunks', () => {
    expect(pageSource).toContain('REALLOCATION_FILTER_CHUNK');
    expect(pageSource).toContain('activeLoadIds.slice(index, index + REALLOCATION_FILTER_CHUNK)');
    expect(pageSource).toContain('fetchAllPostgrestPages');
    expect(pageSource).toContain('.range(from, to)');
  });

  it('rejects a projected pallet or weight overload before transport', () => {
    expect(() => assertReallocationCapacity({
      currentPallets: 8, addedPallets: 2, maxPallets: 9,
      currentWeightKg: 900, addedWeightKg: 50, maxWeightKg: 1_000,
    })).toThrow(/capacidade/);
    expect(() => assertReallocationCapacity({
      currentPallets: 8, addedPallets: 1, maxPallets: 9,
      currentWeightKg: 900, addedWeightKg: 101, maxWeightKg: 1_000,
    })).toThrow(/capacidade/);
  });

  it('keeps capacity enforcement authoritative and atomic in the database', () => {
    expect(migrationSource).toContain('target_load_capacity_exceeded');
    expect(migrationSource).toContain('for update nowait');
    expect(migrationSource).toContain('v_current_pallets + v_added_pallets > v_max_pallets');
    expect(migrationSource).toContain('v_current_weight_kg + v_added_weight_kg > v_max_weight_kg');
    expect(migrationSource).toMatch(/revoke all on function public\.move_load_items_between_loads_unguarded_20260917[\s\S]*authenticated/);
  });

  it('turns a server capacity rejection into actionable operator guidance', () => {
    expect(compositionMutationError({ code: '23514', message: 'target_load_capacity_exceeded' }).message)
      .toContain('excederia a capacidade');
  });

  it('cleans an eligible source load even before it belongs to a trip', () => {
    expect(cleanupMigrationSource).toContain('perform public.delete_load_if_empty(_source_load_id)');
    expect(cleanupMigrationSource).toContain("jsonb_set(v_result, '{source_removed}'");
    expect(cleanupMigrationSource).not.toContain('if v_source_trip is not null');
  });
});
