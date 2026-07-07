import type { LoadControlRow } from '@/hooks/useLoadControl';

const csvEscape = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const dt = (v?: string | null) => v ? v.slice(0, 10).split('-').reverse().join('/') : '';
const money = (v?: number | null) => v == null ? '' : Number(v).toFixed(2).replace('.', ',');

export function exportLoadControlCsv(rows: LoadControlRow[], filename = 'controle-cargas.csv') {
  const header = [
    'Nº Carga','Cliente','Data Carga','Data Chegada','Valor Faturado','Valor Frete','% Frete',
    'Peso','NFs','CT-es','Motorista','Placa','Status Op.','Status Fat.','Status Fin.',
    'Prev. Pagamento','Data Pagamento','Recebido','Saldo',
  ];
  const body = rows.map(r => [
    r.external_load_number || r.load_number, r.client_name || '',
    dt(r.load_date), dt(r.arrival_date),
    money(r.gross_cargo_value), money(r.freight_amount),
    r.freight_percent == null ? '' : (Number(r.freight_percent) * 100).toFixed(2).replace('.', ',') + '%',
    money(r.total_weight_kg), r.invoice_count ?? 0, r.cte_count ?? 0,
    r.driver_name || '', r.plate || '',
    r.operational_status || '', r.billing_status || '', r.payment_status || '',
    dt(r.expected_payment_date), dt(r.payment_date),
    money(r.received_amount),
    money((Number(r.freight_amount || 0) - Number(r.received_amount || 0))),
  ]);
  const csv = '\uFEFF' + [header, ...body].map(cols => cols.map(csvEscape).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}