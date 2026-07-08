import type { PalletProtocol } from '@/hooks/usePalletReturns';

export interface SupplierReportRow {
  supplierName: string;
  totalProtocols: number;
  totalPallets: number;
  pbr: number;
  chep: number;
  others: number;
  lastReturnAt: string | null;
}

export function buildSupplierReport(protocols: PalletProtocol[]): SupplierReportRow[] {
  const map = new Map<string, SupplierReportRow>();
  for (const p of protocols) {
    const key = p.supplier_name_snapshot || '(sem fornecedor)';
    const row = map.get(key) || {
      supplierName: key,
      totalProtocols: 0,
      totalPallets: 0,
      pbr: 0,
      chep: 0,
      others: 0,
      lastReturnAt: null,
    };
    row.totalProtocols += 1;
    row.totalPallets += p.total_quantity || 0;
    for (const it of p.items || []) {
      const c = (it.pallet_type_code || '').toUpperCase();
      if (c === 'PBR') row.pbr += it.quantity;
      else if (c === 'CHEP') row.chep += it.quantity;
      else row.others += it.quantity;
    }
    const rd = p.returned_at || p.issue_date;
    if (rd && (!row.lastReturnAt || rd > row.lastReturnAt)) row.lastReturnAt = rd;
    map.set(key, row);
  }
  return Array.from(map.values()).sort((a, b) => b.totalPallets - a.totalPallets);
}

export interface MonthlyReportRow {
  yearMonth: string;
  supplierName: string;
  palletType: string;
  quantity: number;
  protocols: number;
}

export function buildMonthlyReport(protocols: PalletProtocol[]): MonthlyReportRow[] {
  const map = new Map<string, MonthlyReportRow>();
  for (const p of protocols) {
    const base = (p.returned_at || p.issue_date || '').slice(0, 7);
    if (!base) continue;
    for (const it of p.items || []) {
      const k = `${base}#${p.supplier_name_snapshot}#${it.pallet_type_code}`;
      const row = map.get(k) || {
        yearMonth: base,
        supplierName: p.supplier_name_snapshot,
        palletType: it.pallet_type_code,
        quantity: 0,
        protocols: 0,
      };
      row.quantity += it.quantity;
      row.protocols += 1;
      map.set(k, row);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth) || a.supplierName.localeCompare(b.supplierName));
}

export interface PalletTypeRankingRow {
  palletType: string;
  quantity: number;
  protocols: number;
  suppliers: number;
}

export function buildPalletTypeRanking(protocols: PalletProtocol[]): PalletTypeRankingRow[] {
  const map = new Map<string, { quantity: number; protocolSet: Set<string>; supplierSet: Set<string> }>();
  for (const p of protocols) {
    for (const it of p.items || []) {
      const entry = map.get(it.pallet_type_code) || {
        quantity: 0,
        protocolSet: new Set<string>(),
        supplierSet: new Set<string>(),
      };
      entry.quantity += it.quantity;
      entry.protocolSet.add(p.id);
      entry.supplierSet.add(p.supplier_name_snapshot);
      map.set(it.pallet_type_code, entry);
    }
  }
  return Array.from(map.entries())
    .map(([palletType, v]) => ({ palletType, quantity: v.quantity, protocols: v.protocolSet.size, suppliers: v.supplierSet.size }))
    .sort((a, b) => b.quantity - a.quantity);
}

export function pendingProtocols(protocols: PalletProtocol[]): PalletProtocol[] {
  return protocols.filter((p) => !['confirmed', 'cancelled'].includes(p.status));
}

export function daysSince(dateISO: string | null | undefined): number | null {
  if (!dateISO) return null;
  const d = new Date(dateISO).getTime();
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d) / (1000 * 60 * 60 * 24));
}

export function totalsByPalletType(protocols: PalletProtocol[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of protocols) {
    for (const it of p.items || []) {
      out[it.pallet_type_code] = (out[it.pallet_type_code] || 0) + it.quantity;
    }
  }
  return out;
}