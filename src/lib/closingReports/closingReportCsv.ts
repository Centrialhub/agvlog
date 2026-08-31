import type { BuiltItem,SummaryLine } from './closingReportBuilder';
import {closingItemTrace} from './closingExport';

const brl = (n: number) => Number(n || 0).toFixed(2).replace('.', ',');
const kg = (n: number) => Number(n || 0).toFixed(3).replace('.', ',');
const dt = (v?: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '');
const esc = (v: unknown) => {
  const raw = v == null ? '' : String(v);
  const s = /^[\s]*[=+@-]/.test(raw) ? "'"+raw : raw;
  if (/[";\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
};

export function buildDetailedCsv(items: BuiltItem[]): string {
  const headers = ['Origem', 'Remetente', 'Destinatário', 'Destino', 'Emissão', 'Nº Nota', 'CT-e', 'Valor Nota (não somar tentativas da mesma NF)', 'Peso', 'Frete', 'Data Entrega', 'Observação','Carga','Tentativa','Resultado auditado','Revisão financeira'];
  const rows = items.map(i => [
    i.origin_city, i.remitter_name, i.recipient_name, i.destination_city,
    dt(i.issue_date), i.invoice_number, i.cte_number,
    brl(i.invoice_value), kg(i.weight_kg), brl(i.freight_value),
    dt(i.delivery_date), i.observation,i.load_number,closingItemTrace(i).attempt,closingItemTrace(i).outcome,closingItemTrace(i).review,
  ]);
  return '\uFEFF' + [headers, ...rows].map(r => r.map(esc).join(';')).join('\n');
}
export function buildSummaryCsv(rows:SummaryLine[]){
 return '\uFEFF'+[['Grupo','Notas distintas no grupo','Peso (kg)','Valor NF','Frete'],...rows.map(row=>[row.group_label,row.fiscal_document_count,kg(row.total_weight_kg),brl(row.total_invoice_value),brl(row.total_freight_value)])].map(row=>row.map(esc).join(';')).join('\n');
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}
