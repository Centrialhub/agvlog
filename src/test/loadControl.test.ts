import { describe, it, expect } from 'vitest';
import {
  splitMultiValue, excelSerialToIso, extractLegacyExpectedPayment,
  extractLegacyClosedDate, toNumber, toPercentFraction, computeFinancialStatus,
} from '@/lib/loadImports/loadImportNormalizer';
import {
  parseSummarySheet, parseDetailSheet, parseUnloadingSheet, detectSpreadsheetKind,
} from '@/lib/loadImports/spreadsheetLoadImport';

describe('loadImportNormalizer helpers', () => {
  it('splits CT-es with / ; and spaces', () => {
    expect(splitMultiValue('45671/45672;45673')).toEqual(['45671', '45672', '45673']);
    expect(splitMultiValue('')).toEqual([]);
    expect(splitMultiValue(null)).toEqual([]);
  });
  it('converts Excel serial numbers to ISO', () => {
    expect(excelSerialToIso(45992)).toBe('2025-11-14'); // 2025-11-14 in Excel
  });
  it('reads Date objects and dd/mm/yyyy strings', () => {
    expect(excelSerialToIso(new Date(Date.UTC(2026, 0, 23)))).toBe('2026-01-23');
    expect(excelSerialToIso('23/01/2026')).toBe('2026-01-23');
  });
  it('extracts expected payment date from legacy STATUS text', () => {
    expect(extractLegacyExpectedPayment('FECHADO 08/01 - PREVISÃO PAGAMENTO DIA 23/01/2026'))
      .toBe('2026-01-23');
    expect(extractLegacyExpectedPayment(null)).toBeNull();
  });
  it('extracts closed date', () => {
    expect(extractLegacyClosedDate('FECHADO 08/01', 2026)).toBe('2026-01-08');
    expect(extractLegacyClosedDate('sem data')).toBeNull();
  });
  it('toNumber handles pt-BR', () => {
    expect(toNumber('R$ 1.234,56')).toBeCloseTo(1234.56);
    expect(toNumber(null)).toBe(0);
  });
  it('toPercentFraction converts 0.09 and "9%" to 0.09', () => {
    expect(toPercentFraction(0.09)).toBeCloseTo(0.09);
    expect(toPercentFraction('9%')).toBeCloseTo(0.09);
    expect(toPercentFraction(9)).toBeCloseTo(0.09);
    expect(toPercentFraction(null)).toBeNull();
  });
});

describe('computeFinancialStatus', () => {
  const today = new Date('2026-07-07T00:00:00Z');
  it('unpaid when no payment and future due', () => {
    expect(computeFinancialStatus({ freight_amount: 100, received_amount: 0, expected_payment_date: '2026-08-01', today })).toBe('unpaid');
  });
  it('unpaid when no due', () => {
    expect(computeFinancialStatus({ freight_amount: 100, received_amount: 0, today })).toBe('unpaid');
  });
  it('overdue when no payment and past due', () => {
    expect(computeFinancialStatus({ freight_amount: 100, received_amount: 0, expected_payment_date: '2026-01-01', today })).toBe('overdue');
  });
  it('partially_paid when partial', () => {
    expect(computeFinancialStatus({ freight_amount: 100, received_amount: 40, today })).toBe('partially_paid');
  });
  it('paid when >= freight', () => {
    expect(computeFinancialStatus({ freight_amount: 100, received_amount: 100, today })).toBe('paid');
  });
  it('cancelled overrides', () => {
    expect(computeFinancialStatus({ freight_amount: 100, received_amount: 0, operational_status: 'cancelled', today })).toBe('cancelled');
  });
});

describe('summary sheet parser', () => {
  const rows = [
    ['TÍTULO'],
    [],
    [null, 'DATA DA CARGA', 'DATA CHEGADA', 'CARGA', 'R$ VALOR FATURADO', 'VALOR FRETE', 'cte', 'STATUS'],
    [null, new Date(Date.UTC(2025, 11, 20)), null, 428078, 12812.98, 768.78, '45667', 'FECHADO 08/01 - PREVISÃO PAGAMENTO DIA 23/01/2026'],
    [null, new Date(Date.UTC(2025, 11, 20)), null, 428086, 6036.59, 362.19, '45664/45665/45666', 'FECHADO 08/01'],
    [null, 'TOTAL:', null, null, 18849.57, 1130.97, null, null],
  ];
  it('detects kind', () => expect(detectSpreadsheetKind(rows)).toBe('summary'));
  it('parses financial and CT-e split', () => {
    const { rows: out } = parseSummarySheet(rows);
    expect(out).toHaveLength(2);
    expect(out[0].external_load_number).toBe('428078');
    expect(out[0].freight_amount).toBeCloseTo(768.78);
    expect(out[0].expected_payment_date).toBe('2026-01-23');
    expect(out[0].legacy_status_text).toContain('FECHADO');
    expect(out[1].cte_numbers).toEqual(['45664', '45665', '45666']);
  });
});

describe('detail sheet parser', () => {
  const rows = [
    ['CARGAS'],
    [null, null, null, null, null, null, null, null, null, null, null],
    ['NFiscal', 'CARGA', 'Fornecedor', 'Data de Emissão', 'Destinatário', 'Destino', '% frete', 'Peso', 'Valor NF', 'Valor frete', 'Frete total'],
    [304730, 22876, 'CLARA', new Date(Date.UTC(2026, 5, 18)), 'GALA', 'SALINAS', 0.09, 70.01, 1244.43, 111.99, 111.99],
    ['28009; 28010', 7113, 'BUEN', new Date(Date.UTC(2026, 5, 18)), 'CEMA', 'MONTES CLAROS', 0.09, 274.585, 8284.91, 745.64, 745.64],
  ];
  it('splits multi-NF fields', () => {
    const { rows: out } = parseDetailSheet(rows);
    expect(out).toHaveLength(2);
    expect(out[0].external_load_number).toBe('22876');
    expect(out[1].invoice_numbers).toEqual(['28009', '28010']);
    expect(out[0].freight_percent).toBeCloseTo(0.09);
  });
});

describe('unloading sheet parser', () => {
  const rows = [
    [null, 'RELAÇÃO DE DESCARGA'],
    [null, 'NOTA FISCAL', 'CLIENTE', 'FORNECEDOR', 'CIDADE', 'DATA', 'VALOR'],
    [null, 304732, 'BH', 'CLARA', 'MONTES CLAROS', new Date(Date.UTC(2026, 5, 23)), 10],
    [null, '304972; 28059', 'GALA', 'CLARA; BUEN', 'MONTES CLAROS', new Date(Date.UTC(2026, 5, 24)), 10.4],
  ];
  it('splits multi-NF and multiple suppliers', () => {
    const { rows: out } = parseUnloadingSheet(rows);
    expect(out).toHaveLength(2);
    expect(out[1].invoice_numbers).toEqual(['304972', '28059']);
    expect(out[1].supplier_names).toEqual(['CLARA', 'BUEN']);
    expect(out[0].amount).toBe(10);
  });
});