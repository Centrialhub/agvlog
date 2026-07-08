import * as XLSX from 'xlsx';
import type { ShortageReportRow } from './shortageReportBuilder';
import { driverBreakdown, companyBreakdown, observationBreakdown, totalOf } from './shortageReportBuilder';
import { monthLabel } from './shortageCalculator';

export interface ShortageExcelMeta {
  month?: number;
  year?: number;
  filters?: Record<string, unknown>;
  companyName?: string;
}

export function shortageReportToExcelWorkbook(rows: ShortageReportRow[], meta: ShortageExcelMeta = {}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const header = ['Data','Empresa','Motorista','NF','Cidade','Cliente','Descrição do Produto','Quantidade','Custo Unitário','Total (R$)','Observação'];
  const dataRows = rows.map(r => [
    r.occurrence_date, r.company_name, r.driver_name, r.invoice_number, r.city, r.customer_name,
    r.product_description, r.quantity_text ?? r.quantity, r.unit_cost ?? 0, r.total_amount ?? 0, r.observation,
  ]);
  const totalRow = ['TOTAL', '', '', '', '', '', '', '', '', totalOf(rows), ''];
  const title = meta.month && meta.year
    ? [`CONTROLE MENSAL - FALTA DE MERCADORIA`, monthLabel(meta.month, meta.year)]
    : ['CONTROLE MENSAL - FALTA DE MERCADORIA'];
  const ws = XLSX.utils.aoa_to_sheet([title, [], header, ...dataRows, [], totalRow]);
  ws['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 10 }, { wch: 18 }, { wch: 28 }, { wch: 40 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 28 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 3 } as never;
  XLSX.utils.book_append_sheet(wb, ws, 'Relatório Mensal');

  // Resumo
  const total = totalOf(rows);
  const resumo = [
    ['Resumo', ''],
    ['Ocorrências (itens)', rows.length],
    ['Total (R$)', total],
    ['Mês/Ano', meta.month && meta.year ? monthLabel(meta.month, meta.year) : ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), 'Resumo');

  // Por Motorista
  const drv = [['Motorista','Itens','Total (R$)'], ...driverBreakdown(rows).map(d => [d.driver_name, d.item_count, d.total_amount])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(drv), 'Por Motorista');

  const cmp = [['Empresa','Itens','Total (R$)'], ...companyBreakdown(rows).map(d => [d.company_name, d.item_count, d.total_amount])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cmp), 'Por Empresa');

  const obs = [['Observação','Itens','Total (R$)'], ...observationBreakdown(rows).map(d => [d.observation, d.item_count, d.total_amount])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(obs), 'Por Observação');

  const metaSheet = [
    ['Empresa', meta.companyName ?? ''],
    ['Gerado em', new Date().toLocaleString('pt-BR')],
    ['Filtros', JSON.stringify(meta.filters ?? {})],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metaSheet), 'Metadados');

  return wb;
}

export function shortageReportToExcelBlob(rows: ShortageReportRow[], meta: ShortageExcelMeta = {}): Blob {
  const wb = shortageReportToExcelWorkbook(rows, meta);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
