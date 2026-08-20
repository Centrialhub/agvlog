import { describe, it, expect } from 'vitest';
import {
  resolveNoteStatus, getImportedNoteSummaryTotals, groupNotesBy,
  exportImportedNotesCsv,
} from '@/hooks/useImportedNotesSummary';

const mk = (over: any = {}): any => ({
  id: over.id || 'x',
  invoice_number: '1',
  imported_at: '2026-06-01T10:00:00Z',
  issue_date: '2026-05-30',
  remitter: 'ACME', recipient: 'CLIENT',
  origin_city: 'BELO HORIZONTE', origin_state: 'MG',
  recipient_city: 'SAO PAULO', recipient_state: 'SP',
  value: 1000, weight_kg: 10, volume_count: 1,
  freight_value: 50, freight_cif_value: 50, freight_fob_value: 0,
  imported_note_status: null, status: null, delivery_meta: null,
  load_id: null, client_id: null, document_type: 'inbound',
  loads: null, cte_id: null, cte_number: null,
  operational_status: 'not_processed',
  ...over,
});

describe('resolveNoteStatus', () => {
  it('não processado quando sem load nem CT-e', () => {
    expect(resolveNoteStatus(mk())).toBe('not_processed');
  });
  it('processado com CT-e vinculado', () => {
    expect(resolveNoteStatus(mk({ cte_id: 'c1' }))).toBe('processed');
  });
  it('em trânsito quando load.status = in_transit', () => {
    expect(resolveNoteStatus(mk({ load_id: 'l1', loads: { status: 'in_transit' } }))).toBe('in_transit');
  });
  it('entregue por delivery_meta.delivered', () => {
    expect(resolveNoteStatus(mk({ delivery_meta: { delivered: true } }))).toBe('delivered');
  });
  it('entregue quando load.status = delivered', () => {
    expect(resolveNoteStatus(mk({ load_id: 'l1', loads: { status: 'delivered' } }))).toBe('delivered');
  });
  it('prioriza imported_note_status quando preenchido', () => {
    expect(resolveNoteStatus(mk({ imported_note_status: 'transferred', load_id: 'l1', loads: { status: 'in_transit' } }))).toBe('transferred');
  });
});

describe('groupNotesBy + totals', () => {
  const rows = [
    mk({ id: 'a', recipient_city: 'SP', value: 100, weight_kg: 5, volume_count: 2, freight_cif_value: 10, freight_fob_value: 5 }),
    mk({ id: 'b', recipient_city: 'SP', value: 200, weight_kg: 5, volume_count: 3, freight_cif_value: 20, freight_fob_value: 0 }),
    mk({ id: 'c', recipient_city: 'RJ', value: 300, weight_kg: 7, volume_count: 1, freight_cif_value: 30, freight_fob_value: 0 }),
  ];
  it('agrupa por destino com subtotais corretos', () => {
    const gs = groupNotesBy(rows, 'destination');
    const sp = gs.find(g => g.key.startsWith('SP'))!;
    const rj = gs.find(g => g.key.startsWith('RJ'))!;
    expect(sp.items).toHaveLength(2);
    expect(sp.totals.totalValue).toBe(300);
    expect(sp.totals.totalCif).toBe(30);
    expect(rj.totals.totalValue).toBe(300);
  });
  it('totais gerais somam sem duplicar quando CT-e existe', () => {
    const withCte = rows.map(r => ({ ...r, cte_id: 'shared', cte_number: '99' }));
    const t = getImportedNoteSummaryTotals(withCte as any);
    expect(t.totalValue).toBe(600);
    expect(t.rowCount).toBe(3);
  });
  it('agrupa "SEM DESTINO" quando cidade destino vazia', () => {
    const gs = groupNotesBy([mk({ recipient_city: null, recipient_state: null })], 'destination');
    expect(gs[0].key).toBe('SEM DESTINO');
  });
});

describe('exportImportedNotesCsv', () => {
  it('gera CSV com BOM, ; separador e mesmas linhas', () => {
    const csv = exportImportedNotesCsv([mk()] as any);
    expect(csv.startsWith('\ufeff')).toBe(true);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('Nº Nota');
    expect(lines).toHaveLength(2);
    expect(lines[1].split(';').length).toBe(22);
  });
});