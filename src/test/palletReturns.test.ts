import { describe, it, expect } from 'vitest';
import {
  parsePalletReturnSheet,
  detectSupplierFromTitle,
  detectCompanyOrigin,
  protocolDedupeKey,
} from '@/lib/palletReturns/palletReturnImporter';
import {
  buildSupplierReport,
  buildMonthlyReport,
  buildPalletTypeRanking,
  pendingProtocols,
  totalsByPalletType,
} from '@/lib/palletReturns/palletReturnReports';
import * as XLSX from 'xlsx';
import type { PalletProtocol } from '@/hooks/usePalletReturns';

function makeSheet() {
  const wb = XLSX.utils.book_new();
  const rows = [
    [null, null, null, null, null],
    [null, 'DEVOLUÇÃO PALETES  P/ ALIANÇA', null, null, null],
    [null, 'DEVOLUÇÃO DA AGV DISTRIBUIÇÃO E LOGÍSTICA  P/  ALIANÇA', null, null, 'DATA: 06/07/2026'],
    [null, 'TIPO / COR', 'QTD', null, null],
    [null, 'PBR', 16, null, null],
    [null, 'CHEP', 2, null, null],
    [null, 'TOTAL:', 18, null, null],
    [null, null, null, null, null],
    [null, 'Recebemos de; AGV DISTRIBUIÇÃO E LOGÍSTICA a quantidade de paletes total relacionada acima.', null, null, null],
    [null, 'ASSINATURA', null, null, 'DATA'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Plan1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('palletReturns importer', () => {
  it('detects supplier ALIANÇA from title', () => {
    expect(detectSupplierFromTitle('DEVOLUÇÃO PALETES  P/ ALIANÇA')).toBe('ALIANÇA');
    expect(detectSupplierFromTitle('DEVOLUCAO PALETES P/ FORNECEDOR X')).toBe('FORNECEDOR X');
  });

  it('detects company origin AGV DISTRIBUIÇÃO', () => {
    expect(detectCompanyOrigin('DEVOLUÇÃO DA AGV DISTRIBUIÇÃO E LOGÍSTICA  P/  ALIANÇA')).toContain('AGV DISTRIBUIÇÃO');
  });

  it('parses PBR=16, CHEP=2, total=18 from legacy sheet', () => {
    const buf = makeSheet();
    const parsed = parsePalletReturnSheet(buf);
    expect(parsed.supplier).toBe('ALIANÇA');
    expect(parsed.issueDate).toBe('2026-07-06');
    const pbr = parsed.items.find((i) => i.code === 'PBR');
    const chep = parsed.items.find((i) => i.code === 'CHEP');
    expect(pbr?.quantity).toBe(16);
    expect(chep?.quantity).toBe(2);
    expect(parsed.totalCalculated).toBe(18);
    expect(parsed.totalDeclared).toBe(18);
    expect(parsed.hasTotalDivergence).toBe(false);
  });

  it('flags divergence when declared total mismatches', () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['DEVOLUÇÃO PALETES P/ TESTE', null], ['DATA: 01/07/2026', null], ['TIPO / COR', 'QTD'], ['PBR', 5], ['TOTAL', 99],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const p = parsePalletReturnSheet(buf);
    expect(p.hasTotalDivergence).toBe(true);
  });

  it('produces stable dedupe key regardless of item order', () => {
    const a = protocolDedupeKey('ALIANÇA', '2026-07-06', [{ code: 'PBR', name: 'PBR', quantity: 16 }, { code: 'CHEP', name: 'CHEP', quantity: 2 }]);
    const b = protocolDedupeKey('ALIANÇA', '2026-07-06', [{ code: 'CHEP', name: 'CHEP', quantity: 2 }, { code: 'PBR', name: 'PBR', quantity: 16 }]);
    expect(a).toBe(b);
  });
});

function mkProt(overrides: Partial<PalletProtocol>): PalletProtocol {
  return {
    id: overrides.id || Math.random().toString(36),
    tenant_id: 't', protocol_number: overrides.protocol_number || 'PAL-2026-0001',
    supplier_id: null, supplier_name_snapshot: overrides.supplier_name_snapshot || 'ALIANÇA',
    supplier_document_snapshot: null, company_snapshot: {},
    issue_date: overrides.issue_date || '2026-07-06',
    expected_return_date: null,
    returned_at: overrides.returned_at ?? '2026-07-06',
    confirmed_at: overrides.confirmed_at ?? null,
    status: overrides.status || 'confirmed',
    total_quantity: overrides.total_quantity ?? 18,
    driver_id: null, vehicle_id: null, load_id: null,
    driver_name_snapshot: null, vehicle_plate_snapshot: null,
    notes: null, receiver_name: null, receiver_document: null, receiver_phone: null,
    signature_date: null, signed_proof_url: null, pdf_url: null,
    cancellation_reason: null, cancelled_at: null,
    created_at: '', updated_at: '', created_by: null, confirmed_by: null,
    items: overrides.items || [
      { id: '1', protocol_id: '', pallet_type_id: null, pallet_type_code: 'PBR', pallet_type_name: 'PBR', pallet_color: null, quantity: 16, notes: null, sort_order: 0 },
      { id: '2', protocol_id: '', pallet_type_id: null, pallet_type_code: 'CHEP', pallet_type_name: 'CHEP', pallet_color: null, quantity: 2, notes: null, sort_order: 1 },
    ],
  };
}

describe('palletReturns reports', () => {
  const protocols: PalletProtocol[] = [
    mkProt({ id: 'a' }),
    mkProt({ id: 'b', supplier_name_snapshot: 'OUTRA', total_quantity: 5, items: [{ id: '3', protocol_id: '', pallet_type_id: null, pallet_type_code: 'PBR', pallet_type_name: 'PBR', pallet_color: null, quantity: 5, notes: null, sort_order: 0 }] }),
    mkProt({ id: 'c', status: 'returned', confirmed_at: null }),
  ];

  it('supplier report totalises PBR/CHEP separately', () => {
    const rep = buildSupplierReport(protocols);
    const alianca = rep.find((r) => r.supplierName === 'ALIANÇA')!;
    expect(alianca.pbr).toBe(32); // 16 * 2
    expect(alianca.chep).toBe(4); // 2 * 2
    expect(alianca.totalPallets).toBe(36);
  });

  it('monthly report groups by year-month, supplier, type', () => {
    const rep = buildMonthlyReport(protocols);
    const pbrJul = rep.find((r) => r.yearMonth === '2026-07' && r.supplierName === 'ALIANÇA' && r.palletType === 'PBR');
    expect(pbrJul?.quantity).toBe(32);
  });

  it('ranking sums quantities and unique suppliers per type', () => {
    const rep = buildPalletTypeRanking(protocols);
    const pbr = rep.find((r) => r.palletType === 'PBR')!;
    expect(pbr.quantity).toBe(37);
    expect(pbr.suppliers).toBe(2);
  });

  it('pending returns only non-confirmed/cancelled', () => {
    const pending = pendingProtocols(protocols);
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe('c');
  });

  it('totalsByPalletType aggregates all items', () => {
    const t = totalsByPalletType(protocols);
    expect(t.PBR).toBe(37);
    expect(t.CHEP).toBe(4);
  });
});