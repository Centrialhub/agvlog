import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { RuralProfile } from '@/hooks/useRuralClients';
import { accessTypeLabel, deliveryModeLabel } from './ruralDeliveryReports';

export interface RuralReportOptions {
  title?: string;
  tenantName?: string;
  filters?: Record<string, string>;
  groupByCity?: boolean;
}

export function generateRuralClientsPdf(rows: RuralProfile[], options: RuralReportOptions = {}): Blob {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const title = options.title || 'Relatório de Clientes Zona Rural';
  const now = new Date().toLocaleString('pt-BR');

  doc.setFontSize(14);
  doc.text(title, 14, 14);
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`${options.tenantName || ''}  •  Emitido em ${now}  •  ${rows.length} registro(s)`, 14, 20);

  if (options.filters) {
    const chunks = Object.entries(options.filters).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    if (chunks.length) doc.text('Filtros: ' + chunks.join(' | '), 14, 26);
  }

  const groups = options.groupByCity
    ? Object.entries(rows.reduce<Record<string, RuralProfile[]>>((acc, r) => {
        const k = r.city || '(sem cidade)';
        (acc[k] = acc[k] || []).push(r); return acc;
      }, {})).sort(([a], [b]) => a.localeCompare(b))
    : [['Todos', rows] as [string, RuralProfile[]]];

  let startY = options.filters ? 32 : 28;
  for (const [cityName, group] of groups) {
    doc.setFontSize(11); doc.setTextColor(20);
    doc.text(cityName, 14, startY);
    startY += 2;
    autoTable(doc, {
      startY: startY + 2,
      head: [['Cliente', 'Bairro', 'Fornecedor', 'Acesso', 'KM', 'Modo', 'Ligar', 'Táxi', 'Contato', 'Instrução Motorista']],
      body: group.map(r => [
        r.client_name || '',
        r.neighborhood || r.locality || '',
        r.related_remitter_name || '',
        accessTypeLabel(r.access_type),
        r.round_trip_km ?? '',
        deliveryModeLabel(r.delivery_mode),
        r.requires_contact_before_delivery ? 'Sim' : '',
        r.taxi_required ? 'Sim' : '',
        r.contact_phone || '',
        (r.driver_instructions || '').slice(0, 90),
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [40, 82, 138], textColor: 255 },
      margin: { left: 10, right: 10 },
      didDrawPage: (data) => {
        const pg = doc.getNumberOfPages();
        doc.setFontSize(8); doc.setTextColor(120);
        doc.text(`Página ${data.pageNumber} de ${pg}`, 275, 200);
      },
    });
    startY = (doc as any).lastAutoTable.finalY + 8;
    if (startY > 190) { doc.addPage(); startY = 14; }
  }

  return doc.output('blob');
}