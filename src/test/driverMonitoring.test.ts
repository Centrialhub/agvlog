import { describe, it, expect } from 'vitest';
import {
  calculateCompletedDeliveries, calculateRemainingDeliveries, calculateProgressPercent,
  calculateExpectedReturnDate, calculateDriverStatus, detectDelayedRoute,
  normalizeStatusLabel, parseRemainingCities, normalizePlannedRoute,
} from '@/lib/driverMonitoring/driverMonitoringCalculator';
import { excelSerialToTime } from '@/lib/driverMonitoring/driverMonitoringSpreadsheetImport';
import { excelSerialToIso } from '@/lib/loadImports/loadImportNormalizer';

describe('driverMonitoringCalculator', () => {
  it('sums completed deliveries', () => {
    expect(calculateCompletedDeliveries([
      { update_date: '2026-06-01', deliveries_completed_in_city: 3 },
      { update_date: '2026-06-02', deliveries_completed_in_city: 5 },
      { update_date: '2026-06-03', deliveries_completed_in_city: null as any },
    ])).toBe(8);
  });

  it('never returns negative remaining', () => {
    expect(calculateRemainingDeliveries(10, 15)).toBe(0);
    expect(calculateRemainingDeliveries(10, 3)).toBe(7);
  });

  it('caps progress at 100', () => {
    expect(calculateProgressPercent(10, 15)).toBe(100);
    expect(calculateProgressPercent(10, 0)).toBe(0);
    expect(calculateProgressPercent(0, 0)).toBe(0);
    expect(calculateProgressPercent(4, 1)).toBe(25);
  });

  it('calculates expected return', () => {
    expect(calculateExpectedReturnDate('2026-06-01T00:00:00Z', 5)).toBe('2026-06-06');
    expect(calculateExpectedReturnDate(null, 5)).toBeNull();
  });

  it('detects delayed route', () => {
    const now = new Date('2026-06-10T10:00:00Z');
    expect(detectDelayedRoute({ total_deliveries: 10, completed_deliveries: 5, expected_return_date: '2026-06-01' }, now)).toBe(true);
    expect(detectDelayedRoute({ total_deliveries: 10, completed_deliveries: 10, expected_return_date: '2026-06-01' }, now)).toBe(false);
    expect(detectDelayedRoute({ total_deliveries: 10, completed_deliveries: 5, expected_return_date: '2026-06-20' }, now)).toBe(false);
  });

  it('drives status by deadline and last update', () => {
    const now = new Date('2026-06-10T12:00:00Z');
    const s1 = calculateDriverStatus(
      { total_deliveries: 10, completed_deliveries: 4, expected_return_date: '2026-06-01', last_update_at: now.toISOString() },
      [{ update_date: '2026-06-05', deliveries_completed_in_city: 4 }], now,
    );
    expect(s1).toBe('delayed');

    const s2 = calculateDriverStatus(
      { total_deliveries: 10, completed_deliveries: 10, expected_return_date: '2026-06-20' },
      [{ update_date: '2026-06-05', deliveries_completed_in_city: 10 }], now,
    );
    expect(s2).toBe('returning');

    const s3 = calculateDriverStatus(
      { total_deliveries: 10, completed_deliveries: 3, expected_return_date: '2026-06-20', last_update_at: '2026-06-05T00:00:00Z' },
      [{ update_date: '2026-06-05', deliveries_completed_in_city: 3 }], now,
    );
    expect(s3).toBe('no_update');

    const s4 = calculateDriverStatus(
      { total_deliveries: 10, completed_deliveries: 3, expected_return_date: '2026-06-20', last_update_at: now.toISOString() },
      [{ update_date: '2026-06-10', deliveries_completed_in_city: 3 }], now,
    );
    expect(s4).toBe('on_time');

    const s5 = calculateDriverStatus(
      { total_deliveries: 10, completed_deliveries: 3, actual_returned_at: '2026-06-10T00:00:00Z' } as any,
      [], now,
    );
    expect(['completed', 'arrived']).toContain(s5);
  });

  it('normalizes legacy status labels', () => {
    expect(normalizeStatusLabel('Atrasado')).toBe('delayed');
    expect(normalizeStatusLabel('No prazo')).toBe('on_time');
    expect(normalizeStatusLabel('Retornando')).toBe('returning');
    expect(normalizeStatusLabel('')).toBeNull();
  });

  it('parses remaining cities and planned route', () => {
    expect(parseRemainingCities('Bocaiúva, Grão Mogol; Salinas')).toEqual(['Bocaiúva', 'Grão Mogol', 'Salinas']);
    const p = normalizePlannedRoute('Rota planejada: Montes Claros / Bocaiúva / Salinas');
    expect(p.cities).toContain('Bocaiúva');
  });
});

describe('excel serial conversions', () => {
  it('converts Excel serial dates', () => {
    // 45444 == 2024-06-01 in Excel
    expect(excelSerialToIso(45444)).toBe('2024-06-01');
  });

  it('converts Excel serial times HH:mm', () => {
    // 0.5 = 12:00
    expect(excelSerialToTime(0.5)).toBe('12:00');
    // 0.75 = 18:00
    expect(excelSerialToTime(0.75)).toBe('18:00');
    expect(excelSerialToTime('09:30')).toBe('09:30');
    expect(excelSerialToTime(null)).toBeNull();
  });
});