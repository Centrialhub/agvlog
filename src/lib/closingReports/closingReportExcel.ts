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

  // Controle de Viagens (agrupado por load/veículo/motorista)
  const tripHeader = [
    'ROTA', 'COMPLEMENTO', 'MOTORISTA', 'PLACA',
    'DATA SAÍDA', 'HORA SAÍDA', 'DATA CHEGADA', 'HORA CHEGADA',
    'NR. DIAS', 'KM INICIAL', 'KM FINAL', 'KM RODADO',
    'QUANTIDADE LITROS', 'PREÇO LITRO', 'VR. TOTAL COMBUSTÍVEL', 'CONSUMO POR LITRO',
  ];
  const tripKey = (i: any) => i.load_id || `nf-${i.fiscal_document_id}`;
  const tripMap = new Map<string, any>();
  const order: string[] = [];
  for (const i of items as any[]) {
    const k = tripKey(i);
    if (!tripMap.has(k)) { tripMap.set(k, i); order.push(k); }
  }
  const tripRows: any[][] = [
    [`CONTROLE DE VIAGENS — ${clientName ?? ''}`],
    [`Período: ${fmtDateBR(periodStart)} a ${fmtDateBR(periodEnd)}`],
    [],
    tripHeader,
  ];
  const tot = { km: 0, l: 0, val: 0 };
  for (const k of order) {
    const i: any = tripMap.get(k);
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
  tripWs['!freeze'] = { xSplit: 0, ySplit: 4 } as any;
  XLSX.utils.book_append_sheet(wb, tripWs, 'Controle de Viagens');

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
