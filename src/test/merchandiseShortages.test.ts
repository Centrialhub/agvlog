import { describe, it, expect } from 'vitest';
import {
  parseQuantity, computeItemTotal, computeCaseTotal, validateCase, validateFinalize,
  detectShortageType, inferResponsibleParty, monthLabel,
} from '@/lib/merchandiseShortages/shortageCalculator';
import { parseShortageWorkbook } from '@/lib/merchandiseShortages/shortageLegacyImport';
import { shortageReportToCsv } from '@/lib/merchandiseShortages/shortageReportCsv';
import { driverBreakdown, companyBreakdown, totalOf } from '@/lib/merchandiseShortages/shortageReportBuilder';
import * as XLSX from 'xlsx';

describe('parseQuantity', () => {
  it('parses "1UN"', () => expect(parseQuantity('1UN')).toMatchObject({ quantity: 1, unit: 'UN' }));
  it('parses "24"', () => expect(parseQuantity('24').quantity).toBe(24));
  it('parses "2CX"', () => expect(parseQuantity('2CX').quantity).toBe(2));
  it('parses "1 display com 10"', () => expect(parseQuantity('1 display com 10').quantity).toBe(10));
  it('parses "1cx com 6"', () => expect(parseQuantity('1cx com 6').quantity).toBe(6));
  it('preserves text on non-parseable', () => {
    const r = parseQuantity('varios');
    expect(r.quantity).toBeNull();
  });
});

describe('computeItemTotal / computeCaseTotal', () => {
  it('multiplies quantity by unit cost', () => {
    expect(computeItemTotal({ product_description: 'x', quantity: 3, unit_cost: 10 })).toBe(30);
  });
  it('sums items', () => {
    const items = [
      { product_description: 'a', quantity: 2, unit_cost: 5, total_amount: 10 },
      { product_description: 'b', quantity: 1, unit_cost: 7, total_amount: 7 },
    ];
    expect(computeCaseTotal(items)).toBe(17);
  });
});

describe('validateCase', () => {
  it('requires date/invoice/items', () => {
    const errs = validateCase({ items: [] });
    expect(errs.some(e => e.field === 'occurrence_date')).toBe(true);
    expect(errs.some(e => e.field === 'invoice_number')).toBe(true);
    expect(errs.some(e => e.field === 'items')).toBe(true);
  });
  it('passes on valid input', () => {
    const errs = validateCase({
      occurrence_date: '2024-02-10',
      invoice_number: '123',
      items: [{ product_description: 'p', quantity: 1, unit_cost: 1 }],
    });
    expect(errs).toEqual([]);
  });
});

describe('validateFinalize', () => {
  it('requires responsible to close', () => {
    const errs = validateFinalize('closed', {});
    expect(errs.some(e => e.field === 'responsible_party_type')).toBe(true);
  });
  it('requires driver id if driver party', () => {
    const errs = validateFinalize('closed', { responsible_party_type: 'driver' });
    expect(errs.some(e => e.field === 'responsible_driver_id')).toBe(true);
  });
  it('requires cancellation reason', () => {
    const errs = validateFinalize('cancelled', {});
    expect(errs.some(e => e.field === 'cancellation_reason')).toBe(true);
  });
});

describe('detectShortageType', () => {
  it('detects não localizado', () => expect(detectShortageType('NÃO LOCALIZADO NO VEICULO')).toBe('not_found_in_vehicle'));
  it('detects falta do fornecedor', () => expect(detectShortageType('FALTA DO FORNECEDOR')).toBe('supplier_fault'));
  it('detects falta direto (asa)', () => expect(detectShortageType('FALTA DIRETO DA ASA')).toBe('supplier_fault'));
  it('supplier fault infers supplier party', () => expect(inferResponsibleParty('supplier_fault')).toBe('supplier'));
});

describe('shortageReportToCsv', () => {
  it('serializes rows with header/title/total', () => {
    const csv = shortageReportToCsv([
      {
        occurrence_date: '2024-02-10', company_name: 'AGV', driver_name: 'Marcelo',
        invoice_number: '251926', city: 'SJP', customer_name: 'Vanessa',
        product_description: 'HAVAIANAS', quantity_text: '1UN', quantity: 1, unit: 'UN',
        unit_cost: 37.98, total_amount: 37.98, observation: 'NÃO LOCALIZADO',
        status: 'investigating', responsible_party_type: null,
      },
    ], { month: 2, year: 2024 });
    expect(csv).toContain('CONTROLE MENSAL - FALTA DE MERCADORIA');
    expect(csv).toContain('FEVEREIRO/2024');
    expect(csv).toContain('HAVAIANAS');
    expect(csv).toContain('37,98');
  });
});

describe('breakdowns', () => {
  const rows = [
    { occurrence_date: '2024-02-10', company_name: 'AGV', driver_name: 'A', invoice_number: '1', city: null, customer_name: null, product_description: 'x', quantity_text: null, quantity: 1, unit: null, unit_cost: 5, total_amount: 5, observation: null, status: null, responsible_party_type: null },
    { occurrence_date: '2024-02-10', company_name: 'AGV', driver_name: 'B', invoice_number: '2', city: null, customer_name: null, product_description: 'y', quantity_text: null, quantity: 1, unit: null, unit_cost: 3, total_amount: 3, observation: null, status: null, responsible_party_type: null },
  ];
  it('drives correct totals', () => {
    expect(totalOf(rows)).toBe(8);
    expect(driverBreakdown(rows)).toHaveLength(2);
    expect(companyBreakdown(rows)[0].total_amount).toBe(8);
  });
});

describe('monthLabel', () => {
  it('formats FEVEREIRO/2024', () => expect(monthLabel(2, 2024)).toBe('FEVEREIRO/2024'));
});

describe('parseShortageWorkbook', () => {
  it('parses a minimal legacy sheet grouping same NF into one case', () => {
    const aoa = [
      [null, null],
      [null, 'CONTROLE MENSAL - FALTA DE MERCADORIA'],
      [null, 'FEVEREIRO/2024'],
      [null],
      [null, 'Data', 'Empresa', 'Motorista', 'NF', 'Cidade', 'Cliente', 'Descrição do Produto:', 'Quantidade', 'Custo unitario', 'Total (R$)', 'Observação'],
      [null, '10/02/2024', 'P.SEVERINI NETO', 'MARCELO', '251926', 'SJP', 'VANESSA', 'HAVAIANAS 39', '1UN', 37.98, 37.98, 'NÃO LOCALIZADO NO VEICULO'],
      [null, '10/02/2024', 'P.SEVERINI NETO', 'MARCELO', '251926', 'SJP', 'VANESSA', 'CHINELO 42', '2CX', 10, 20, 'NÃO LOCALIZADO NO VEICULO'],
      [null, '10/02/2024', 'P.SEVERINI NETO', 'GUSTAVO', '269437', 'SF', 'WELTON', 'BISC MAFRA', 1, 43.59, 43.59, 'FALTA DIRETO DA ASA'],
      [null, 'TOTAIS', null, null, null, null, null, null, null, null, 101.57],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'FEVEREIRO');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const preview = parseShortageWorkbook(buf, 'test.xlsx');
    expect(preview.validRows).toBe(3);
    expect(preview.cases).toHaveLength(2);
    const marceloCase = preview.cases.find(c => c.driver === 'MARCELO')!;
    expect(marceloCase.items).toHaveLength(2);
    expect(marceloCase.total_amount).toBeCloseTo(57.98, 2);
    expect(marceloCase.shortage_type).toBe('not_found_in_vehicle');
    const gustavoCase = preview.cases.find(c => c.driver === 'GUSTAVO')!;
    expect(gustavoCase.shortage_type).toBe('supplier_fault');
    expect(gustavoCase.responsible_party_type).toBe('supplier');
    expect(preview.skippedSubtotals).toBeGreaterThanOrEqual(1);
  });
});
