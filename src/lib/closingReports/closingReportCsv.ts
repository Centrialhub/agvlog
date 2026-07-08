import type { BuiltItem } from './closingReportBuilder';

const brl = (n: number) => Number(n || 0).toFixed(2).replace('.', ',');
const kg = (n: number) => Number(n || 0).toFixed(3).replace('.', ',');
const dt = (v?: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '');
const esc = (v: any) => {
  const s = v == null ? '' : String(v);
  if (/[";\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
};

export function buildDetailedCsv(items: BuiltItem[]): string {
  const headers = ['Origem', 'Remetente', 'Destinatário', 'Destino', 'Emissão', 'Nº Nota', 'CT-e', 'Valor Nota', 'Peso', 'Frete', 'Data Entrega', 'Observação'];
  const rows = items.map(i => [
    i.origin_city, i.remitter_name, i.recipient_name, i.destination_city,
    dt(i.issue_date), i.invoice_number, i.cte_number,
    brl(i.invoice_value), kg(i.weight_kg), brl(i.freight_value),
    dt(i.delivery_date), i.observation,
  ]);
  return '\uFEFF' + [headers, ...rows].map(r => r.map(esc).join(';')).join('\n');
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}
