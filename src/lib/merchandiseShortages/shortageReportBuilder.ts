import { round2 } from './shortageCalculator';

export interface ShortageReportRow {
  occurrence_date: string | null;
  company_name: string | null;
  driver_name: string | null;
  invoice_number: string | null;
  city: string | null;
  customer_name: string | null;
  product_description: string | null;
  quantity_text: string | null;
  quantity: number | null;
  unit: string | null;
  unit_cost: number | null;
  total_amount: number | null;
  observation: string | null;
  status: string | null;
  responsible_party_type: string | null;
}

export interface GroupedShortageReport {
  groupKey: string;
  rows: ShortageReportRow[];
  subtotal: number;
  itemCount: number;
}

export function groupReport(rows: ShortageReportRow[], by: 'company' | 'driver' | 'observation' | 'week' | 'none'): GroupedShortageReport[] {
  if (by === 'none') return [{ groupKey: 'TODOS', rows, subtotal: totalOf(rows), itemCount: rows.length }];
  const map = new Map<string, ShortageReportRow[]>();
  for (const r of rows) {
    let k = 'N/D';
    if (by === 'company') k = r.company_name || 'N/D';
    else if (by === 'driver') k = r.driver_name || 'N/D';
    else if (by === 'observation') k = r.observation || 'N/D';
    else if (by === 'week' && r.occurrence_date) {
      const d = new Date(r.occurrence_date);
      const first = new Date(d.getFullYear(), 0, 1);
      const week = Math.ceil(((d.getTime() - first.getTime()) / 86400000 + first.getDay() + 1) / 7);
      k = `Semana ${week}`;
    }
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return Array.from(map.entries()).map(([groupKey, rs]) => ({ groupKey, rows: rs, subtotal: totalOf(rs), itemCount: rs.length }));
}

export function totalOf(rows: ShortageReportRow[]): number {
  return round2(rows.reduce((a, r) => a + (r.total_amount ?? 0), 0));
}

export interface DriverBreakdown {
  driver_name: string;
  case_count: number;
  item_count: number;
  total_amount: number;
}

export function driverBreakdown(rows: ShortageReportRow[]): DriverBreakdown[] {
  const map = new Map<string, DriverBreakdown>();
  for (const r of rows) {
    const k = r.driver_name || 'N/D';
    const b = map.get(k) ?? { driver_name: k, case_count: 0, item_count: 0, total_amount: 0 };
    b.item_count += 1;
    b.total_amount = round2(b.total_amount + (r.total_amount ?? 0));
    map.set(k, b);
  }
  return Array.from(map.values()).sort((a, b) => b.total_amount - a.total_amount);
}

export function companyBreakdown(rows: ShortageReportRow[]): { company_name: string; item_count: number; total_amount: number }[] {
  const map = new Map<string, { company_name: string; item_count: number; total_amount: number }>();
  for (const r of rows) {
    const k = r.company_name || 'N/D';
    const b = map.get(k) ?? { company_name: k, item_count: 0, total_amount: 0 };
    b.item_count += 1;
    b.total_amount = round2(b.total_amount + (r.total_amount ?? 0));
    map.set(k, b);
  }
  return Array.from(map.values()).sort((a, b) => b.total_amount - a.total_amount);
}

export function observationBreakdown(rows: ShortageReportRow[]): { observation: string; item_count: number; total_amount: number }[] {
  const map = new Map<string, { observation: string; item_count: number; total_amount: number }>();
  for (const r of rows) {
    const k = r.observation || 'N/D';
    const b = map.get(k) ?? { observation: k, item_count: 0, total_amount: 0 };
    b.item_count += 1;
    b.total_amount = round2(b.total_amount + (r.total_amount ?? 0));
    map.set(k, b);
  }
  return Array.from(map.values()).sort((a, b) => b.total_amount - a.total_amount);
}