import type { PalletProtocol } from '@/hooks/usePalletReturns';

const BOM = '\uFEFF';

function esc(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[";\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('pt-BR');
}

export function protocolsToCsv(protocols: PalletProtocol[]): string {
  const header = [
    'Protocolo', 'Data Lançamento', 'Data Devolução', 'Fornecedor', 'Status',
    'Total Paletes', 'Tipos', 'Motorista', 'Placa', 'Carga', 'Recebedor', 'Confirmado em',
  ];
  const lines = protocols.map((p) => [
    p.protocol_number,
    fmtDate(p.issue_date),
    fmtDate(p.returned_at),
    p.supplier_name_snapshot,
    p.status,
    p.total_quantity,
    (p.items || []).map((i) => `${i.pallet_type_code}:${i.quantity}`).join(' '),
    p.driver_name_snapshot || '',
    p.vehicle_plate_snapshot || '',
    p.load_id || '',
    p.receiver_name || '',
    fmtDate(p.confirmed_at),
  ].map(esc).join(';'));
  return BOM + [header.join(';'), ...lines].join('\n');
}

export function rowsToCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const head = headers.join(';');
  const body = rows.map((r) => r.map(esc).join(';')).join('\n');
  return BOM + head + '\n' + body;
}

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}