import { describe, it, expect } from 'vitest';
import {
  validateFinalize,
  splitInvoiceNumbers,
  toIsoDate,
  parseBrCurrency,
  isUnservedInWeek,
  aggregateOccurrences,
} from '@/lib/occurrenceReports/occurrenceReportBuilder';
import { detectModelFromRows } from '@/lib/occurrenceReports/legacyOccurrenceImport';
import { returnedNotesCsv, unservedNotesCsv, toCsvString } from '@/lib/occurrenceReports/occurrenceReportCsv';

describe('validateFinalize', () => {
  it('requires resolution_type', () => {
    const errs = validateFinalize({});
    expect(errs.some((e) => e.field === 'resolution_type')).toBe(true);
  });
  it('accepts a total return with description', () => {
    const errs = validateFinalize({ resolution_type: 'returned_total', resolution_notes: 'OK' });
    expect(errs).toEqual([]);
  });
  it('rejects partial return without items', () => {
    const errs = validateFinalize({ resolution_type: 'returned_partial', resolution_notes: 'x' });
    expect(errs.some((e) => e.field === 'items')).toBe(true);
  });
  it('accepts partial return with an item description', () => {
    const errs = validateFinalize({
      resolution_type: 'returned_partial',
      resolution_notes: 'motivo',
      items: [{ product_description: 'Produto X', quantity_text: '2FD' }],
    });
    expect(errs).toEqual([]);
  });
});

describe('splitInvoiceNumbers', () => {
  it('splits by / and ;', () => {
    expect(splitInvoiceNumbers('578812/578813/578814')).toEqual(['578812', '578813', '578814']);
    expect(splitInvoiceNumbers('1;2, 3')).toEqual(['1', '2', '3']);
  });
  it('returns [] for null', () => {
    expect(splitInvoiceNumbers(null)).toEqual([]);
  });
});

describe('toIsoDate & parseBrCurrency', () => {
  it('converts Excel serial numbers', () => {
    const iso = toIsoDate(45870);
    expect(iso).toBe('2025-08-01');
  });
  it('converts dd/MM/yyyy', () => {
    expect(toIsoDate('11/06/2026')).toBe('2026-06-11');
  });
  it('parses Brazilian currency', () => {
    expect(parseBrCurrency('R$1,251,71')).toBeCloseTo(1251.71, 2);
    expect(parseBrCurrency('1.610,67')).toBeCloseTo(1610.67, 2);
    expect(parseBrCurrency(720.15)).toBe(720.15);
  });
});

describe('isUnservedInWeek', () => {
  const wk = { start: '2026-06-07', end: '2026-06-13' };
  it('flags pending invoices with no dispatch date', () => {
    expect(isUnservedInWeek({ invoice_number: '1', status: 'Pendente' }, wk.start, wk.end)).toBe(true);
  });
  it('does not flag delivered invoices', () => {
    expect(isUnservedInWeek({ invoice_number: '1', delivered_at: '2026-06-08' }, wk.start, wk.end)).toBe(false);
  });
  it('does not flag cancelled invoices', () => {
    expect(isUnservedInWeek({ invoice_number: '1', cancelled: true }, wk.start, wk.end)).toBe(false);
  });
  it('does not flag returned_total unless requested', () => {
    expect(isUnservedInWeek({ invoice_number: '1', returned_total: true }, wk.start, wk.end)).toBe(false);
    expect(isUnservedInWeek({ invoice_number: '1', returned_total: true }, wk.start, wk.end, { includeReturned: true })).toBe(true);
  });
  it('does not flag invoices dispatched within the week', () => {
    expect(isUnservedInWeek({ invoice_number: '1', dispatched_at: '2026-06-09' }, wk.start, wk.end)).toBe(false);
  });
});

describe('aggregateOccurrences', () => {
  it('counts resolutions per bucket', () => {
    const agg = aggregateOccurrences([
      { resolution_type: 'returned_total', invoice_value: 100, customer_name: 'A', supplier_name: 'X' },
      { resolution_type: 'returned_partial', invoice_value: 50, customer_name: 'B', supplier_name: 'X' },
      { resolution_type: 'shortage_found', invoice_value: 25, customer_name: 'B', supplier_name: 'Y' },
      { resolution_type: 'no_dispatch_week', invoice_value: 10, customer_name: 'C', supplier_name: 'Y' },
    ]);
    expect(agg.returnedTotal).toBe(1);
    expect(agg.returnedPartial).toBe(1);
    expect(agg.shortages).toBe(1);
    expect(agg.unservedWeek).toBe(1);
    expect(agg.clients).toBe(3);
    expect(agg.suppliers).toBe(2);
    expect(agg.totalInvoiceValue).toBe(185);
  });
});

describe('detectModelFromRows', () => {
  it('detects protocolo de devolução', () => {
    const rows = [
      ['PROTOCOLO DE DEVOLUÇÃO - VILA NOVA'],
      [],
      ['CLIENTE', 'CIDADE', 'Nº OCORRÊNCIA', 'NOTA FISCAL', 'TIPO DE DEVOLUÇÃO', 'Valor', 'MOTIVO', 'QTD', 'DESCRIÇÃO', 'SENHA'],
    ];
    expect(detectModelFromRows(rows)).toBe('returned_notes');
  });
  it('detects unserved notes week model', () => {
    const rows = [
      [null, null, 'P.SEVERINI NETTO'],
      [],
      [null, 'NF', 'Cliente', 'Cidade', 'data da NF', 'Valor', 'fornecedor', 'OBS'],
    ];
    expect(detectModelFromRows(rows)).toBe('unserved_notes_week');
  });
});

describe('CSV writers', () => {
  it('writes returned notes CSV with ; separator and BOM', () => {
    const blob = returnedNotesCsv([{
      customer_name: 'NOVO MILENIO', city: 'JANUARIA', occurrence_number: '600366',
      invoice_number: '566819', return_type: 'PARCIAL', invoice_value: 150,
      reason: 'DIVERGÊNCIA', quantity_text: '150UN', product_description: 'CALDO MAGGI',
      password_or_authorization: '615632',
    }]);
    expect(blob).toBeInstanceOf(Blob);
    const text = toCsvString(
      ['Cliente', 'Cidade'],
      [{ a: 'NOVO MILENIO', b: 'JANUARIA' }],
      ['a', 'b'],
    );
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Cliente;Cidade');
    expect(text).toContain('NOVO MILENIO;JANUARIA');
  });
  it('writes unserved notes CSV', () => {
    const blob = unservedNotesCsv([{
      invoice_number: '578712', customer_name: 'ANTONIO WELLINGTON', city: 'BONITO DE MINAS',
      invoice_issue_date: '2026-07-03', invoice_value: 1610.67, supplier_name: 'P.SEVERINI', notes: 'QUINZENAL',
    }]);
    expect(blob).toBeInstanceOf(Blob);
    const text = toCsvString(
      ['NF', 'Cliente', 'Data'],
      [{ nf: '578712', cliente: 'ANTONIO WELLINGTON', data: '03/07/2026' }],
      ['nf', 'cliente', 'data'],
    );
    expect(text).toContain('578712;ANTONIO WELLINGTON');
    expect(text).toContain('03/07/2026');
  });
});
