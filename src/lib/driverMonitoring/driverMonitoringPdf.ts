import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { DriverMonitorRow, ProgressUpdateRow, ForecastRow } from '@/hooks/useDriverMonitoring';
import { STATUS_LABELS } from './driverMonitoringCalculator';
import { drawCompanyHeader, type CompanyPdfInfo } from '@/lib/pdf/companyHeader';

const dt = (v?: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '—');
const tm = (v?: string | null) => (v ? v.slice(0, 5) : '—');

interface HeaderOpts {
  title: string;
  companyName?: string;
  company?: CompanyPdfInfo;
  filters?: string;
  landscape?: boolean;
}

function baseDoc({ title, companyName = 'AGVLog', company, filters, landscape = true }: HeaderOpts) {
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const info: CompanyPdfInfo = company ?? { name: companyName };
  const y = drawCompanyHeader(doc, info, { y: 10 });
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
  doc.text(title, 14, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 14, y + 10);
  if (filters) doc.text(filters, 14, y + 14);
  (doc as any).__headerBottom = y + (filters ? 18 : 14);
  return doc;
}

function footerPagination(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(`Página ${i} de ${pages}`, doc.internal.pageSize.getWidth() - 30, doc.internal.pageSize.getHeight() - 8);
  }
}

export function driversInRoutePdf(rows: DriverMonitorRow[], filters?: string) {
  return driversInRoutePdfWith(rows, filters);
}
export function driversInRoutePdfWith(rows: DriverMonitorRow[], filters?: string, company?: CompanyPdfInfo) {
  const doc = baseDoc({ title: 'Relatório de Motoristas em Rota', filters, company });
  autoTable(doc, {
    startY: (doc as any).__headerBottom,
    head: [['Motorista', 'Placa', 'Carga', 'Total', 'Real.', 'Falt.', '%', 'Cidade Atual', 'Próxima', 'Prazo', 'Status']],
    body: rows.map((r) => [
      r.driver_name_snapshot || '—',
      r.vehicle_plate_snapshot || '—',
      r.load_number || '—',
      r.total_deliveries,
      r.completed_deliveries,
      r.remaining_deliveries,
      r.progress_percent + '%',
      r.current_city || '—',
      r.next_city || '—',
      dt(r.expected_return_date),
      STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] || r.status,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [40, 60, 90] },
    showHead: 'everyPage',
  });
  footerPagination(doc);
  return doc;
}

export function deliveriesByDriverPdf(rows: ProgressUpdateRow[], filters?: string) {
  const doc = baseDoc({ title: 'Relatório de Entregas por Motorista', filters });
  autoTable(doc, {
    startY: filters ? 34 : 30,
    head: [['Data', 'Motorista', 'Cidade', 'Entregas', 'Próxima cidade', 'Qtd próx.', 'H. término', 'Status']],
    body: rows.map((r) => [
      dt(r.update_date), r.driver_name || '—', r.city || '—',
      r.deliveries_completed_in_city,
      r.next_city || '—', r.next_city_deliveries ?? '—',
      tm(r.city_finished_at), r.status || '—',
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [40, 60, 90] },
  });
  footerPagination(doc);
  return doc;
}

export function arrivalForecastsPdf(rows: ForecastRow[], filters?: string) {
  const doc = baseDoc({ title: 'Relatório de Chegada de Veículos', filters });
  autoTable(doc, {
    startY: filters ? 34 : 30,
    head: [['Data', 'Hora', 'Motorista', 'Cidade Atual', 'Previsão Montes Claros', 'Cidades Restantes', 'Status']],
    body: rows.map((r) => [
      dt(r.forecast_date), tm(r.forecast_time), r.driver_name || '—',
      r.current_city || '—', r.forecast_text || '—',
      r.remaining_cities_text || '—',
      STATUS_LABELS[r.status as keyof typeof STATUS_LABELS] || r.status,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [40, 60, 90] },
  });
  footerPagination(doc);
  return doc;
}

export function delaysPdf(rows: DriverMonitorRow[], filters?: string) {
  const now = Date.now();
  const doc = baseDoc({ title: 'Relatório de Atrasos', filters });
  autoTable(doc, {
    startY: filters ? 34 : 30,
    head: [['Motorista', 'Carga', 'Cidade Atual', 'Total', 'Falt.', 'Prazo Retorno', 'Dias Atraso', 'Últ. Atualização']],
    body: rows.map((r) => {
      const daysLate = r.expected_return_date ? Math.max(0, Math.floor((now - new Date(r.expected_return_date + 'T23:59:59').getTime()) / 86400000)) : 0;
      return [
        r.driver_name_snapshot || '—', r.load_number || '—',
        r.current_city || '—', r.total_deliveries, r.remaining_deliveries,
        dt(r.expected_return_date), daysLate, r.last_update_at ? new Date(r.last_update_at).toLocaleString('pt-BR') : '—',
      ];
    }),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [140, 40, 40] },
  });
  footerPagination(doc);
  return doc;
}

export function productivityPdf(rows: DriverMonitorRow[], filters?: string) {
  const doc = baseDoc({ title: 'Relatório de Produtividade', filters });
  const byDriver = new Map<string, { total: number; completed: number; routes: number; delays: number }>();
  for (const r of rows) {
    const key = r.driver_name_snapshot || 'Sem motorista';
    const cur = byDriver.get(key) || { total: 0, completed: 0, routes: 0, delays: 0 };
    cur.total += r.total_deliveries;
    cur.completed += r.completed_deliveries;
    cur.routes += 1;
    if (r.status === 'delayed') cur.delays += 1;
    byDriver.set(key, cur);
  }
  autoTable(doc, {
    startY: filters ? 34 : 30,
    head: [['Motorista', 'Previstas', 'Realizadas', 'Rotas', 'Atrasos', '% No prazo']],
    body: [...byDriver.entries()].map(([driver, v]) => [
      driver, v.total, v.completed, v.routes, v.delays,
      v.routes ? Math.round(((v.routes - v.delays) / v.routes) * 100) + '%' : '—',
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [40, 60, 90] },
  });
  footerPagination(doc);
  return doc;
}

export function downloadPdf(doc: jsPDF, filename: string) {
  doc.save(filename);
}