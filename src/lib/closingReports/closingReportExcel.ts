import * as XLSX from 'xlsx';
import type { BuiltItem, BuiltPreview, Divergence } from './closingReportBuilder';

export interface ExcelInput {
  title: string;
  clientName?: string | null;
  periodStart: string;
  periodEnd: string;
  items: BuiltItem[];
  preview?: BuiltPreview;
  divergences?: Divergence[];
}

function autoWidth(rows: any[][]) {
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, i) => {
    const l = c == null ? 0 : String(c).length;
    widths[i] = Math.max(widths[i] ?? 8, Math.min(l + 2, 40));
  });
  return widths.map(w => ({ wch: w }));
}

export function buildWorkbook({ title, clientName, periodStart, periodEnd, items, divergences }: ExcelInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // Resumo
  const resumoRows: any[][] = [
    [title],
    [`Cliente: ${clientName ?? '—'}`],
    [`Período: ${periodStart} a ${periodEnd}`],
    [],
    ['Total Notas', items.length],
    ['Peso total (kg)', items.reduce((s, i) => s + i.weight_kg, 0)],
    ['Valor NF total', items.reduce((s, i) => s + i.invoice_value, 0)],
    ['Frete total', items.reduce((s, i) => s + i.freight_value, 0)],
  ];
  const resumoWs = XLSX.utils.aoa_to_sheet(resumoRows);
  resumoWs['!cols'] = autoWidth(resumoRows);
  XLSX.utils.book_append_sheet(wb, resumoWs, 'Resumo');

  // Detalhado
  const detHeader = ['Origem', 'Remetente', 'Destinatário', 'Destino', 'Emissão', 'Nº Nota', 'CT-e', 'Valor Nota', 'Peso (kg)', 'Frete', 'Data Entrega', 'Observação'];
  const detRows: any[][] = [detHeader];
  items.forEach(i => detRows.push([
    i.origin_city ?? '', i.remitter_name ?? '', i.recipient_name ?? '', i.destination_city ?? '',
    i.issue_date ?? '', i.invoice_number ?? '', i.cte_number ?? '',
    Number(i.invoice_value), Number(i.weight_kg), Number(i.freight_value),
    i.delivery_date ?? '', i.observation ?? '',
  ]));
  const totalRow = ['TOTAIS', '', '', '', '', '', '',
    items.reduce((s, i) => s + i.invoice_value, 0),
    items.reduce((s, i) => s + i.weight_kg, 0),
    items.reduce((s, i) => s + i.freight_value, 0), '', ''];
  detRows.push(totalRow);
  const detWs = XLSX.utils.aoa_to_sheet(detRows);
  detWs['!cols'] = autoWidth(detRows);
  detWs['!freeze'] = { xSplit: 0, ySplit: 1 } as any;
  detWs['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: detHeader.length - 1, r: 0 } }) };
  XLSX.utils.book_append_sheet(wb, detWs, 'Detalhado');

  if (divergences && divergences.length > 0) {
    const divRows: any[][] = [['Severidade', 'Código', 'Descrição', 'NF', 'CT-e', 'Carga']];
    divergences.forEach(d => divRows.push([d.severity, d.code, d.description, d.invoice_number ?? '', d.cte_document_id ?? '', d.load_id ?? '']));
    const divWs = XLSX.utils.aoa_to_sheet(divRows);
    divWs['!cols'] = autoWidth(divRows);
    XLSX.utils.book_append_sheet(wb, divWs, 'Divergências');
  }

  const metaRows: any[][] = [
    ['Título', title],
    ['Cliente', clientName ?? ''],
    ['Período', `${periodStart} a ${periodEnd}`],
    ['Gerado em', new Date().toISOString()],
    ['Total de itens', items.length],
  ];
  const metaWs = XLSX.utils.aoa_to_sheet(metaRows);
  metaWs['!cols'] = autoWidth(metaRows);
  XLSX.utils.book_append_sheet(wb, metaWs, 'Metadados');

  return wb;
}

export function downloadWorkbook(filename: string, wb: XLSX.WorkBook) {
  XLSX.writeFile(wb, filename);
}
