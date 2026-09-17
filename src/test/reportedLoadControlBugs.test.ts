import { describe, expect, it } from 'vitest';
import { buildProductivityRows } from '@/lib/driverMonitoring/driverMonitoringPdf';
import { selectLoadReportRows } from '@/lib/loadReports/loadControlPdf';
import { validateLoadControlDateFilters, type LoadControlRow } from '@/hooks/useLoadControl';
import type { DriverMonitorRow } from '@/hooks/useDriverMonitoring';

function monitor(overrides: Partial<DriverMonitorRow>): DriverMonitorRow {
  return {
    id: crypto.randomUUID(), tenant_id: 'tenant', monitor_number: 'M-1', driver_id: null,
    driver_name_snapshot: 'Ana', vehicle_id: null, vehicle_plate_snapshot: null,
    load_id: null, load_number: null, planned_route_text: null, planned_cities: [],
    started_at: null, expected_return_date: null, return_deadline_days: null,
    actual_returned_at: null, total_deliveries: 10, completed_deliveries: 0,
    remaining_deliveries: 10, progress_percent: 0, current_city: null, next_city: null,
    remaining_cities: [], arrival_forecast_text: null, arrival_forecast_at: null,
    status: 'on_time', last_update_at: null, notes: null, revision: 0,
    updated_at: '2026-09-17T00:00:00Z', ...overrides,
  };
}

function load(payment_status: string, freight = 100, received = 0): LoadControlRow {
  return {
    id: crypto.randomUUID(), tenant_id: 'tenant', load_number: '1', external_load_number: null,
    load_date: null, arrival_date: null, gross_cargo_value: 0, freight_amount: freight,
    freight_percent: null, total_weight_kg: null, invoice_count: 0, cte_count: 0,
    operational_status: null, billing_status: null, payment_status,
    expected_payment_date: null, payment_date: null, received_amount: received,
    legacy_status_text: null,
  };
}

describe('reported load-control regressions', () => {
  it('does not count open, cancelled or problematic routes as on-time productivity', () => {
    const result = buildProductivityRows([
      monitor({ status: 'on_time' }),
      monitor({ status: 'cancelled' }),
      monitor({ status: 'issue' }),
    ])[0];
    expect(result).toMatchObject({ routes: 3, concluded: 0, onTime: 0, onTimePercent: null });
  });

  it('uses only concluded routes with evidence to calculate punctuality', () => {
    const result = buildProductivityRows([
      monitor({ expected_return_date: '2026-09-15', actual_returned_at: '2026-09-15T20:00:00Z' }),
      monitor({ expected_return_date: '2026-09-15', actual_returned_at: '2026-09-16T01:00:00Z' }),
      monitor({ status: 'delayed', expected_return_date: '2026-09-15' }),
    ])[0];
    expect(result).toMatchObject({ routes: 3, concluded: 2, onTime: 1, delays: 1, onTimePercent: 50 });
  });

  it('separates paid and open PDF rows', () => {
    const paid = load('paid', 100, 100);
    const open = load('partially_paid', 100, 20);
    const cancelled = load('cancelled', 100, 0);
    expect(selectLoadReportRows('paid', [paid, open, cancelled])).toEqual([paid]);
    expect(selectLoadReportRows('open', [paid, open, cancelled])).toEqual([open]);
  });

  it('rejects inverted load and payment date ranges', () => {
    expect(validateLoadControlDateFilters({ loadDateFrom: '2026-09-20', loadDateTo: '2026-09-10' })).toContain('carga');
    expect(validateLoadControlDateFilters({ expectedPayFrom: '2026-09-20', expectedPayTo: '2026-09-10' })).toContain('pagamento');
    expect(validateLoadControlDateFilters({ loadDateFrom: '2026-09-10', loadDateTo: '2026-09-20' })).toBeNull();
  });
});
