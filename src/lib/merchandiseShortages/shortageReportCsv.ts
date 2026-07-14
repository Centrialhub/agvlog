import type { ShortageReportRow } from './shortageReportBuilder';
import { formatBRL, monthLabel } from './shortageCalculator';
import { fmtDateSafe } from '@/lib/utils/formatDate';

const BOM = '\uFEFF';

function esc(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[";\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function fmtDate(v: string | null | undefined): string {
  return fmtDateSafe(v, '');
}
function fmtBR(n: number | null | undefined): string {
  if (n == null) return '';
  return n.toFixed(2).replace('.', ',');
}

export function shortageReportToCsv(rows: ShortageReportRow[], meta?: { month?: number; year?: number }): string {
  const header = ['Data','Empresa','Motorista','NF','Cidade','Cliente','Produto','Quantidade','Custo Unitário','Total (R$)','Observação','Status','Responsável'];
  const lines = rows.map(r => [
    fmtDate(r.occurrence_date), r.company_name, r.driver_name, r.invoice_number,
    r.city, r.customer_name, r.product_description,
    r.quantity_text ?? (r.quantity != null ? String(r.quantity) : ''),
    fmtBR(r.unit_cost ?? 0), fmtBR(r.total_amount ?? 0),
    r.observation, r.status, r.responsible_party_type,
  ].map(esc).join(';'));
  const title = meta?.month && meta?.year
    ? `CONTROLE MENSAL - FALTA DE MERCADORIA;${monthLabel(meta.month, meta.year)}`
    : 'CONTROLE MENSAL - FALTA DE MERCADORIA';
  const total = rows.reduce((a, r) => a + (r.total_amount ?? 0), 0);
  return BOM + [title, '', header.join(';'), ...lines, '', `TOTAL;;;;;;;;;${fmtBR(total)}`].join('\n');
}

export function shortageReportToCsvBlob(rows: ShortageReportRow[], meta?: { month?: number; year?: number }): Blob {
  return new Blob([shortageReportToCsv(rows, meta)], { type: 'text/csv;charset=utf-8;' });
}

// Re-export for convenience
export { formatBRL };