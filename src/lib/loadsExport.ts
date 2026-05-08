import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOAD_STATUS_LABELS } from '@/hooks/useLoads';

export interface ExportableLoad {
  load_number: string;
  status: string;
  created_at: string;
  actual_load_at?: string | null;
  origin?: string | null;
  destination?: string | null;
  operation_type?: string | null;
  vehicles?: { plate?: string | null } | null;
  drivers?: { name?: string | null } | null;
  trailer_plate?: string | null;
  monitored?: boolean | null;
  dedicated_vehicle?: boolean | null;
  ciot?: string | null;
  monitor_responsible?: string | null;
  driver_type?: string | null;
  sm_manager?: string | null;
  sm_release?: string | null;
  merchandise_value?: number | null;
  total_pallet_count?: number | null;
  total_weight_kg?: number | null;
  total_volume_m3?: number | null;
  gate_departure_at?: string | null;
  estimated_arrival_at?: string | null;
  arrival_at?: string | null;
}

const fmtDate = (raw?: string | null) => {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR');
};
const fmtDateTime = (raw?: string | null) => {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR');
};
const fmtMoney = (v?: number | null) =>
  v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v?: number | null) =>
  v == null ? '' : Number(v).toLocaleString('pt-BR');
const yn = (v?: boolean | null) => (v ? 'Sim' : 'Não');

const COLUMNS: Array<{ key: string; label: string; get: (l: ExportableLoad) => string }> = [
  { key: 'load_number', label: 'Romaneio', get: l => l.load_number || '' },
  { key: 'status', label: 'Situação', get: l => LOAD_STATUS_LABELS[l.status] || l.status || '' },
  { key: 'created_at', label: 'Emissão', get: l => fmtDate(l.created_at) },
  { key: 'actual_load_at', label: 'Carregamento', get: l => fmtDateTime(l.actual_load_at) },
  { key: 'plate', label: 'Placa', get: l => l.vehicles?.plate || '' },
  { key: 'trailer_plate', label: 'Placa Carreta', get: l => l.trailer_plate || '' },
  { key: 'driver', label: 'Motorista', get: l => l.drivers?.name || '' },
  { key: 'driver_type', label: 'Tipo Motorista', get: l => l.driver_type || '' },
  { key: 'origin', label: 'Origem', get: l => l.origin || '' },
  { key: 'destination', label: 'Destino', get: l => l.destination || '' },
  { key: 'operation_type', label: 'Tipo', get: l => l.operation_type || '' },
  { key: 'monitored', label: 'Monitorado', get: l => yn(l.monitored) },
  { key: 'dedicated_vehicle', label: 'Dedicado', get: l => yn(l.dedicated_vehicle) },
  { key: 'ciot', label: 'CIOT', get: l => l.ciot || '' },
  { key: 'monitor_responsible', label: 'Resp. Monit.', get: l => l.monitor_responsible || '' },
  { key: 'sm_manager', label: 'Gerenciadora SM', get: l => l.sm_manager || '' },
  { key: 'sm_release', label: 'Liberação SM', get: l => l.sm_release || '' },
  { key: 'merchandise_value', label: 'Valor Mercadoria', get: l => fmtMoney(l.merchandise_value) },
  { key: 'total_pallet_count', label: 'Paletes', get: l => fmtNum(l.total_pallet_count) },
  { key: 'total_weight_kg', label: 'Peso (kg)', get: l => fmtNum(l.total_weight_kg) },
  { key: 'total_volume_m3', label: 'Volume (m³)', get: l => fmtNum(l.total_volume_m3) },
  { key: 'gate_departure_at', label: 'Saída Portaria', get: l => fmtDateTime(l.gate_departure_at) },
  { key: 'estimated_arrival_at', label: 'Previsão Chegada', get: l => fmtDateTime(l.estimated_arrival_at) },
  { key: 'arrival_at', label: 'Chegada', get: l => fmtDateTime(l.arrival_at) },
];

const csvEscape = (v: string) => {
  const s = String(v ?? '');
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

export function exportLoadsCSV(loads: ExportableLoad[], filename = 'cargas.csv') {
  const header = COLUMNS.map(c => csvEscape(c.label)).join(';');
  const rows = loads.map(l => COLUMNS.map(c => csvEscape(c.get(l))).join(';'));
  // BOM for Excel UTF-8 detection
  const csv = '\uFEFF' + [header, ...rows].join('\r\n');
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

export function exportLoadsPDF(loads: ExportableLoad[], filename = 'cargas.pdf', title = 'Cargas') {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const generatedAt = new Date().toLocaleString('pt-BR');

  doc.setFontSize(14);
  doc.text(title, 40, 36);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Gerado em ${generatedAt} • ${loads.length} registro(s)`, 40, 52);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 64,
    head: [COLUMNS.map(c => c.label)],
    body: loads.map(l => COLUMNS.map(c => c.get(l))),
    styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 7 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: 20, right: 20 },
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages();
      const pageSize = doc.internal.pageSize;
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `Página ${data.pageNumber} de ${pageCount}`,
        pageSize.getWidth() - 20,
        pageSize.getHeight() - 10,
        { align: 'right' }
      );
    },
  });

  doc.save(filename);
}