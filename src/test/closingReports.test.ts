import { describe, it, expect } from 'vitest';
import {
  buildPreview, computeClosingPaymentStatus, excelSerialToIso,
  periodFromType, groupSummary,
  type RawFiscalDoc, type RawCte, type RawLoad,
} from '@/lib/closingReports/closingReportBuilder';
import { parseLegacyWorkbook, legacyDetailedToItems } from '@/lib/closingReports/closingReportImporter';
import * as XLSX from 'xlsx';
import { buildDetailedCsv } from '@/lib/closingReports/closingReportCsv';
import { buildWorkbook } from '@/lib/closingReports/closingReportExcel';

const nf = (o: Partial<RawFiscalDoc> = {}): RawFiscalDoc => ({
  id: 'f' + Math.random().toString(36).slice(2, 8),
  invoice_number: '1',
  access_key: null,
  issue_date: '2026-06-05',
  origin_city: 'BH', origin_state: 'MG',
  remitter: 'ACME', remitter_cnpj: '11',
  recipient: 'CLIENTE', recipient_cnpj: '22',
  recipient_city: 'SAO PAULO', recipient_state: 'SP',
  value: 1000, weight_kg: 100, volume_count: 1,
  freight_value: 50, freight_cif_value: 50, freight_fob_value: 0,
  load_id: null, client_id: null, imported_note_status: null, delivery_meta: null,
  ...o,
});

describe('buildPreview', () => {
  it('soma totais', () => {
    const p = buildPreview({ fiscalDocs: [nf(), nf({ value: 500, weight_kg: 20, freight_value: 10 })], ctes: [], loads: [] });
    expect(p.items.length).toBe(2);
    expect(p.totals.total_invoice_value).toBe(1500);
    expect(p.totals.total_weight_kg).toBe(120);
    expect(p.totals.total_freight_value).toBe(60);
  });

  it('deduplica por invoice_key', () => {
    const a = nf({ access_key: 'KEY1' });
    const b = nf({ access_key: 'KEY1', invoice_number: '2' });
    const p = buildPreview({ fiscalDocs: [a, b], ctes: [], loads: [] });
    expect(p.items.length).toBe(1);
    expect(p.divergences.some(d => d.code === 'duplicate_document')).toBe(true);
  });

  it('não duplica frete de CT-e com múltiplas NFs (per_nf default)', () => {
    const a = nf({ id: 'A', freight_value: 30 });
    const b = nf({ id: 'B', freight_value: 20 });
    const cte: RawCte = { id: 'C', cte_number: '100', access_key: null, freight_value: 100, weight_kg: 0, fiscal_document_ids: ['A', 'B'] };
    const p = buildPreview({ fiscalDocs: [a, b], ctes: [cte], loads: [], freightAllocation: 'per_nf' });
    // per_nf uses individual freight, sum 50 not 100+50
    expect(p.totals.total_freight_value).toBe(50);
    expect(p.totals.cte_count).toBe(1);
  });

  it('rateia CT-e por valor quando NFs sem frete', () => {
    const a = nf({ id: 'A', freight_value: 0, value: 800 });
    const b = nf({ id: 'B', freight_value: 0, value: 200 });
    const cte: RawCte = { id: 'C', cte_number: '100', access_key: null, freight_value: 100, weight_kg: 0, fiscal_document_ids: ['A', 'B'] };
    const p = buildPreview({ fiscalDocs: [a, b], ctes: [cte], loads: [], freightAllocation: 'cte_by_value' });
    expect(p.totals.total_freight_value).toBe(100);
    expect(p.items.find(i => i.fiscal_document_id === 'A')!.freight_value).toBeCloseTo(80);
    expect(p.items.find(i => i.fiscal_document_id === 'B')!.freight_value).toBeCloseTo(20);
  });

  it('rateia CT-e por peso', () => {
    const a = nf({ id: 'A', freight_value: 0, weight_kg: 30 });
    const b = nf({ id: 'B', freight_value: 0, weight_kg: 70 });
    const cte: RawCte = { id: 'C', cte_number: '100', access_key: null, freight_value: 200, weight_kg: 0, fiscal_document_ids: ['A', 'B'] };
    const p = buildPreview({ fiscalDocs: [a, b], ctes: [cte], loads: [], freightAllocation: 'cte_by_weight' });
    expect(p.items.find(i => i.fiscal_document_id === 'A')!.freight_value).toBeCloseTo(60);
    expect(p.items.find(i => i.fiscal_document_id === 'B')!.freight_value).toBeCloseTo(140);
  });

  it('detecta NF sem CT-e e frete zerado', () => {
    const p = buildPreview({ fiscalDocs: [nf({ freight_value: 0 })], ctes: [], loads: [] });
    expect(p.divergences.some(d => d.code === 'nf_without_cte')).toBe(true);
    expect(p.divergences.some(d => d.code === 'zero_freight')).toBe(true);
  });

  it('detecta entrega anterior à emissão', () => {
    const d = nf({ issue_date: '2026-06-10', delivery_meta: { delivered_at: '2026-06-01' } });
    const p = buildPreview({ fiscalDocs: [d], ctes: [], loads: [] });
    expect(p.divergences.some(x => x.code === 'delivery_before_issue')).toBe(true);
  });

  it('usa arrival_date da carga vinculada', () => {
    const l: RawLoad = { id: 'L1', load_number: '1000', external_load_number: null, arrival_date: '2026-06-07' };
    const p = buildPreview({ fiscalDocs: [nf({ load_id: 'L1' })], ctes: [], loads: [l] });
    expect(p.items[0].arrival_date).toBe('2026-06-07');
    expect(p.items[0].load_number).toBe('1000');
  });
});

describe('groupSummary', () => {
  it('agrupa por destino', () => {
    const items = buildPreview({
      fiscalDocs: [nf({ recipient_city: 'SP' }), nf({ recipient_city: 'SP' }), nf({ recipient_city: 'RJ' })],
      ctes: [], loads: [],
    }).items;
    const g = groupSummary(items, 'destination_city');
    expect(g.length).toBe(2);
    expect(g.find(x => x.group_label === 'SP')!.fiscal_document_count).toBe(2);
  });
});

describe('computeClosingPaymentStatus', () => {
  it('unpaid sem pagamento e sem vencimento', () => {
    expect(computeClosingPaymentStatus({ totalAmount: 100, receivedAmount: 0 })).toBe('unpaid');
  });
  it('overdue sem pagamento e vencimento passado', () => {
    expect(computeClosingPaymentStatus({ totalAmount: 100, receivedAmount: 0, expectedPaymentDate: '2020-01-01' })).toBe('overdue');
  });
  it('parcial', () => {
    expect(computeClosingPaymentStatus({ totalAmount: 100, receivedAmount: 50 })).toBe('partially_paid');
  });
  it('pago', () => {
    expect(computeClosingPaymentStatus({ totalAmount: 100, receivedAmount: 100 })).toBe('paid');
  });
  it('cancelado tem prioridade', () => {
    expect(computeClosingPaymentStatus({ totalAmount: 100, receivedAmount: 100, cancelled: true })).toBe('cancelled');
  });
});

describe('excelSerialToIso', () => {
  it('converte serial 46195 (2026-07-01)', () => {
    expect(excelSerialToIso(46204)).toBe('2026-07-10');
  });
});

describe('periodFromType', () => {
  it('decenal 1ª', () => {
    const p = periodFromType('ten_day', new Date(Date.UTC(2026, 5, 3)));
    expect(p.period_start).toBe('2026-06-01'); expect(p.period_end).toBe('2026-06-10');
  });
  it('decenal 2ª', () => {
    const p = periodFromType('ten_day', new Date(Date.UTC(2026, 5, 15)));
    expect(p.period_start).toBe('2026-06-11'); expect(p.period_end).toBe('2026-06-20');
  });
  it('quinzenal 1ª', () => {
    const p = periodFromType('fortnightly', new Date(Date.UTC(2026, 5, 10)));
    expect(p.period_start).toBe('2026-06-01'); expect(p.period_end).toBe('2026-06-15');
  });
  it('mensal', () => {
    const p = periodFromType('monthly', new Date(Date.UTC(2026, 5, 15)));
    expect(p.period_start).toBe('2026-06-01'); expect(p.period_end).toBe('2026-06-30');
  });
});

describe('parseLegacyWorkbook', () => {
  it('detecta modelo resumo com PESO MANIDESTO', () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['RESUMO CARGAS RECEBIDAS 2026'],
      ['DATA CHEGADA', 'FATURAMENTO', 'PESO MANIDESTO', 'R$ VALOR FATURADO'],
      ['05/06/2026', '1ª DEZENA', 1000, 50000],
      ['08/06/2026', '1ª DEZENA', 500, 25000],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'x');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const r = parseLegacyWorkbook(buf as ArrayBuffer);
    expect(r.model).toBe('summary');
    expect(r.summaryRows.length).toBe(2);
    expect(r.totals.total_weight_kg).toBe(1500);
    expect(r.totals.total_invoice_value).toBe(75000);
  });

  it('detecta modelo detalhado', () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['RELATÓRIO DA 1ª QUINZENA JUNHO/2026 ASTRUM'],
      ['Origem', 'Remetente', 'Destinatário', 'Destino', 'Emissão', 'N Nota', 'Conhecimento', 'Valor Nota', 'Peso', 'Frete', 'Data de Entrega', 'Observação'],
      ['BH', 'ACME', 'CLI', 'SP', '05/06/2026', '1001', '500', 1000, 100, 50, '07/06/2026', ''],
      ['BH', 'ACME', 'CLI2', 'RJ', '06/06/2026', '1002', '501', 500, 50, 25, '08/06/2026', ''],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'x');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const r = parseLegacyWorkbook(buf as ArrayBuffer);
    expect(r.model).toBe('detailed');
    expect(r.detailedRows.length).toBe(2);
    expect(r.totals.total_invoice_value).toBe(1500);
    expect(r.totals.total_freight_value).toBe(75);
    const items = legacyDetailedToItems(r.detailedRows);
    expect(items[0].source_type).toBe('spreadsheet_import');
  });
});

describe('exports', () => {
  const items = buildPreview({ fiscalDocs: [nf(), nf({ value: 500 })], ctes: [], loads: [] }).items;
  it('CSV usa BOM e separador ;', () => {
    const c = buildDetailedCsv(items);
    expect(c.charCodeAt(0)).toBe(0xFEFF);
    expect(c.split('\n')[0].split(';').length).toBeGreaterThan(5);
  });
  it('workbook Excel tem abas Resumo/Detalhado/Metadados', () => {
    const wb = buildWorkbook({ title: 'T', clientName: 'C', periodStart: '2026-06-01', periodEnd: '2026-06-10', items });
    expect(wb.SheetNames).toContain('Resumo');
    expect(wb.SheetNames).toContain('Detalhado');
    expect(wb.SheetNames).toContain('Metadados');
  });
});
