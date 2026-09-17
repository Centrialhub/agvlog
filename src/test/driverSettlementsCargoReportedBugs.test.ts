import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatSettlementGenerationError } from '@/hooks/useDriverSettlements';

const settlementPage = readFileSync('src/pages/DriverSettlements.tsx', 'utf8');
const settlementHook = readFileSync('src/hooks/useDriverSettlements.tsx', 'utf8');
const settlementMigration = readFileSync('supabase/migrations/20260917133000_page_driver_settlements_with_snapshot.sql', 'utf8');
const cargoClient = readFileSync('src/lib/driver/tripCargoCustody.ts', 'utf8');
const cargoPage = readFileSync('src/pages/TripCargoCustody.tsx', 'utf8');
const cargoMigration = readFileSync('supabase/migrations/20260917133500_page_trip_cargo_custody.sql', 'utf8');
const cargoPodHardening = readFileSync('supabase/migrations/20260917134000_harden_cargo_close_and_pod_history.sql', 'utf8');
const podPage = readFileSync('src/pages/PodHistory.tsx', 'utf8');

describe('reported settlement and cargo-custody regressions', () => {
  it('rejects inverted dates in both UI and database', () => {
    expect(settlementPage).toContain('dateFrom > dateTo');
    expect(settlementPage).toContain('A data inicial não pode ser posterior à data final');
    expect(settlementMigration).toContain('_date_from > _date_to');
    expect(settlementMigration).toContain('settlement_date_range_invalid');
  });

  it('makes partial settlement-generation failures visible and identifiable', () => {
    expect(formatSettlementGenerationError({ trip_id: 'trip-17', error: 'sem tarifa' }, 0))
      .toBe('Viagem/acerto trip-17: sem tarifa');
    expect(settlementHook).toContain("title: data.errors.length ? 'Acertos processados com falhas'");
    expect(settlementPage).toContain('continuam pendentes');
  });

  it('uses a frozen snapshot and complete cursor sort key for settlement pages', () => {
    expect(settlementHook).toContain("rpc('list_driver_settlements_v2'");
    expect(settlementMigration).toContain('settlement.created_at <= v_snapshot');
    expect(settlementMigration).toContain('trip_completed_at desc nulls last, base.created_at desc, base.id desc');
    expect(settlementMigration).not.toContain('OFFSET v_offset');
  });

  it('pages custody history and dossier collections instead of imposing aggregate caps', () => {
    expect(cargoClient).toContain("rpc('list_trip_cargo_controls_v2'");
    expect(cargoClient).toContain("rpc('get_trip_cargo_collection_page_v1'");
    expect(cargoClient).not.toContain('.max(5_000)');
    expect(cargoClient).not.toContain('.max(2_000)');
    expect(cargoPage).toContain('list.data.total_count');
    expect(cargoMigration).toContain('limit v_page_size offset v_offset');
  });

  it('allows review only for a pending divergence in an open custody state', () => {
    expect(cargoPage).toContain("row.status === 'pending'");
    expect(cargoPage).toContain("['departed', 'returned', 'closed']");
    expect(cargoMigration).toContain("v_row.status <> 'pending'");
    expect(cargoMigration).toContain("v_control_status in ('departed', 'returned', 'closed')");
    expect(cargoMigration).toContain("where id = v_row.id and status = 'pending'");
  });

  it('blocks custody close until every seal has a complete terminal record', () => {
    expect(cargoPage).toContain('hasUnresolvedSeal');
    expect(cargoPage).toContain('!row.resolution_evidence_id && !row.evidence_waived_legacy');
    expect(cargoPodHardening).toContain('trip_cargo_seals_unresolved');
    expect(cargoPodHardening).toContain("seal_row.status not in('removed','broken','missing')");
  });

  it('clears an open dossier when it is no longer in the filtered list', () => {
    expect(cargoPage).toContain('!list.data.items.some(item => item.trip_id === tripId)');
    expect(cargoPage).toContain('setStatus(event.target.value as TripCargoStatus');
    expect(cargoPage).toContain('setTripId(null)');
  });

  it('scopes POD arrival, current allocation and occurrences to the document lifecycle', () => {
    expect(cargoPodHardening).toContain('a.id=v_current_allocation');
    expect(cargoPodHardening).toContain('a.created_at desc nulls last,a.id desc');
    expect(cargoPodHardening).not.toContain('e.dispatch_stop_id in');
    expect(podPage).not.toContain('history.allocations.at(-1)');
  });
});
