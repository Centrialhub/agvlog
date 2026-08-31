import * as XLSX from 'xlsx';
import type { BuiltItem, BuiltPreview, Divergence, SummaryLine } from './closingReportBuilder';
import {closingExportTotals,closingItemTrace,closingTripKey} from './closingExport';

export interface ExcelInput {
  title: string;
  clientName?: string | null;
  periodStart: string;
  periodEnd: string;
  items: BuiltItem[];
  preview?: BuiltPreview;
  divergences?: Divergence[];
  summaryLines?: SummaryLine[];
}

type SpreadsheetRow = unknown[];
type WorksheetWithFreeze = XLSX.WorkSheet & {
  '!freeze'?: { xSplit: number; ySplit: number };
};

function autoWidth(rows: SpreadsheetRow[]) {
  const widths: number[] = [];
  for (const r of rows) r.forEach((c, i) => {
    const l = c == null ? 0 : String(c).length;
    widths[i] = Math.max(widths[i] ?? 8, Math.min(l + 2, 40));
  });
  return widths.map(w => ({ wch: w }));
}

function fmtDateBR(v?: string | null) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10).split('-').reverse().join('/');
  return s;
}
function fmtTime(v?: string | null) {
  if (!v) return '';
  const s = String(v);
  if (s.length >= 16 && s.includes('T')) return s.slice(11, 16);
  return '';
}

export function buildWorkbook({ title, clientName, periodStart, periodEnd, items, divergences, summaryLines=[] }: ExcelInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const totals=closingExportTotals(items,summaryLines);

  // Resumo
  const resumoRows: SpreadsheetRow[] = [
    [title],
    [`Cliente: ${clientName ?? '—'}`],
    [`Período: ${periodStart} a ${periodEnd}`],
    [],
    ['Notas distintas', totals.notes],
    ['Peso das tentativas (kg)', totals.weight],
    ['Valor das notas distintas', totals.value],
    ['Frete total', totals.freight],
    ['Tentativas / linhas detalhadas', totals.attempts],
    ['Conferência', 'Valores da mesma NF podem aparecer em mais de uma tentativa; o total considera cada nota uma única vez.'],
  ];
  if(summaryLines.length)resumoRows.push([],['Grupo','Notas distintas no grupo','Peso (kg)','Valor NF','Frete'],...summaryLines.map(row=>[row.group_label,row.fiscal_document_count,row.total_weight_kg,row.total_invoice_value,row.total_freight_value]));
  const resumoWs = XLSX.utils.aoa_to_sheet(resumoRows);
  resumoWs['!cols'] = autoWidth(resumoRows);
  XLSX.utils.book_append_sheet(wb, resumoWs, 'Resumo');

  // Detalhado
  const detHeader = ['Origem', 'Remetente', 'Destinatário', 'Destino', 'Emissão', 'Nº Nota', 'CT-e', 'Valor Nota', 'Peso (kg)', 'Frete', 'Data Entrega', 'Observação','Carga','Tentativa','Resultado auditado','Revisão financeira'];
  const detRows: SpreadsheetRow[] = [detHeader];
  items.forEach(i => detRows.push([
    i.origin_city ?? '', i.remitter_name ?? '', i.recipient_name ?? '', i.destination_city ?? '',
    i.issue_date ?? '', i.invoice_number ?? '', i.cte_number ?? '',
    Number(i.invoice_value), Number(i.weight_kg), Number(i.freight_value),
    i.delivery_date ?? '', i.observation ?? '',i.load_number??'',closingItemTrace(i).attempt,closingItemTrace(i).outcome,closingItemTrace(i).review,
  ]));
  const totalRow = ['TOTAIS', '', '', '', '', '', '',
    totals.value, totals.weight, totals.freight, '', ''];
  detRows.push(totalRow);
  const detWs = XLSX.utils.aoa_to_sheet(detRows);
  detWs['!cols'] = autoWidth(detRows);
  (detWs as WorksheetWithFreeze)['!freeze'] = { xSplit: 0, ySplit: 1 };
  detWs['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: detHeader.length - 1, r: 0 } }) };
  XLSX.utils.book_append_sheet(wb, detWs, 'Detalhado');

  // Controle de Viagens (agrupado por load/veículo/motorista)
  const tripHeader = [
    'ROTA', 'COMPLEMENTO', 'MOTORISTA', 'PLACA',
    'DATA SAÍDA', 'HORA SAÍDA', 'DATA CHEGADA', 'HORA CHEGADA',
    'NR. DIAS', 'KM INICIAL', 'KM FINAL', 'KM RODADO',
    'QUANTIDADE LITROS', 'PREÇO LITRO', 'VR. TOTAL COMBUSTÍVEL', 'CONSUMO POR LITRO',
  ];
  const tripKey = closingTripKey;
  const tripMap = new Map<string, BuiltItem>();
  const order: string[] = [];
  for (const i of items) {
    const k = tripKey(i);
    if (!tripMap.has(k)) { tripMap.set(k, i); order.push(k); }
  }
  const tripRows: SpreadsheetRow[] = [
    [`CONTROLE DE VIAGENS — ${clientName ?? ''}`],
    [`Período: ${fmtDateBR(periodStart)} a ${fmtDateBR(periodEnd)}`],
    [],
    tripHeader,
  ];
  const tot = { km: 0, l: 0, val: 0 };
  for (const k of order) {
    const i = tripMap.get(k);
    if (!i) continue;
    const km = Number(i.km_driven || 0);
    const lt = Number(i.fuel_liters || 0);
    const vl = Number(i.fuel_total || 0);
    tot.km += km; tot.l += lt; tot.val += vl;
    tripRows.push([
      i.route_label ?? i.destination_city ?? '',
      i.route_complement ?? i.origin_city ?? '',
      i.driver_name ?? '',
      i.vehicle_plate ?? '',
      fmtDateBR(i.departure_at),
      fmtTime(i.departure_at),
      fmtDateBR(i.arrival_at_ts ?? i.arrival_date),
      fmtTime(i.arrival_at_ts),
      i.days_count ?? '',
      i.km_initial ?? '',
      i.km_final ?? '',
      km || '',
      lt || '',
      i.fuel_unit_price ?? '',
      vl || '',
      i.consumption_km_l ? Number(i.consumption_km_l).toFixed(2) : '',
    ]);
  }
  tripRows.push([
    'TOTAIS', '', '', '', '', '', '', '', '', '', '',
    tot.km || '', tot.l || '', '', tot.val || '',
    tot.l > 0 ? (tot.km / tot.l).toFixed(2) : '',
  ]);
  const tripWs = XLSX.utils.aoa_to_sheet(tripRows);
  tripWs['!cols'] = autoWidth(tripRows);
  (tripWs as WorksheetWithFreeze)['!freeze'] = { xSplit: 0, ySplit: 4 };
  XLSX.utils.book_append_sheet(wb, tripWs, 'Controle de Viagens');

  if (divergences && divergences.length > 0) {
    const divRows: SpreadsheetRow[] = [['Severidade', 'Código', 'Descrição', 'NF', 'CT-e', 'Carga']];
    divergences.forEach(d => divRows.push([d.severity, d.code, d.description, d.invoice_number ?? '', d.cte_document_id ?? '', d.load_id ?? '']));
    const divWs = XLSX.utils.aoa_to_sheet(divRows);
    divWs['!cols'] = autoWidth(divRows);
    XLSX.utils.book_append_sheet(wb, divWs, 'Divergências');
  }

  const metaRows: SpreadsheetRow[] = [
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
