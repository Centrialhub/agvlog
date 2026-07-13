import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { LoadControlRow, UnloadingChargeRow } from '@/hooks/useLoadControl';
import { drawCompanyHeader, type CompanyPdfInfo } from '@/lib/pdf/companyHeader';

const dt = (v?: string | null) => v ? v.slice(0, 10).split('-').reverse().join('/') : '';
const money = (v?: number | null) => v == null ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export type LoadReportKind =
  | 'summary'
  | 'detailed'
  | 'open'
  | 'paid'
  | 'by_client'
  | 'by_city'
  | 'unloading';

export interface LoadReportOptions {
  kind: LoadReportKind;
  title?: string;
  carrierName?: string;
  company?: CompanyPdfInfo;
  filtersText?: string;
  rows: LoadControlRow[];
  unloading?: UnloadingChargeRow[];
}

function header(doc: jsPDF, opts: LoadReportOptions): number {
  const info: CompanyPdfInfo = opts.company ?? { name: opts.carrierName || 'Transportadora' };
  const y = drawCompanyHeader(doc, info, { y: 10 });
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
  doc.text(opts.title || 'Relatório de Cargas', doc.internal.pageSize.getWidth() / 2, 12, { align: 'center' });
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, doc.internal.pageSize.getWidth() - 14, 12, { align: 'right' });
  let ty = y;
  if (opts.filtersText) { doc.text(opts.filtersText, 14, ty + 2); ty += 4; }
  doc.setTextColor(0);
  return ty + 4;
}

function footer(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Página ${i} de ${pages}`, doc.internal.pageSize.getWidth() - 14, doc.internal.pageSize.getHeight() - 6, { align: 'right' });
  }
}

export function downloadLoadControlPdf(opts: LoadReportOptions, filename = 'controle-cargas.pdf') {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const startY = header(doc, opts);

  if (opts.kind === 'unloading' && opts.unloading) {
    const body = opts.unloading.map(u => [
      u.invoice_number || '', u.client_name || '', u.supplier_name || '',
      u.city || '', dt(u.service_date), money(u.amount),
      u.load?.external_load_number || u.load?.load_number || '', u.status,
    ]);
    const total = opts.unloading.reduce((s, u) => s + Number(u.amount || 0), 0);
    autoTable(doc, {
      startY,
      head: [['NF', 'Cliente', 'Fornecedor', 'Cidade', 'Data', 'Valor', 'Carga', 'Status']],
      body, styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      foot: [['', '', '', '', 'Total', money(total), '', '']],
    });
    footer(doc); doc.save(filename); return;
  }

  const HEADS: Record<LoadReportKind, string[]> = {
    summary: ['Data Carga', 'Chegada', 'Carga', 'Faturado', 'Frete', 'CT-es', 'Status Fin.', 'Prev. Pag.', 'Data Pag.', 'Saldo', 'Status Legado'],
    detailed: ['Carga', 'Cliente', 'Faturado', 'Frete', '% Frete', 'Peso', 'NFs', 'CT-es', 'Motorista', 'Placa'],
    open: ['Carga', 'Cliente', 'Frete', 'Prev. Pag.', 'Dias Atraso', 'CT-es', 'Última Obs.'],
    paid: ['Carga', 'Cliente', 'Frete', 'Recebido', 'Data Pag.', 'Fatura', 'Receivable'],
    by_client: ['Cliente', 'Cargas', 'Faturado', 'Frete', 'Peso', 'Pago', 'Em Aberto'],
    by_city: ['Cidade/UF', 'Cargas', 'Peso', 'Faturado', 'Frete'],
    unloading: [],
  };
  const heads = HEADS[opts.kind];
  const body = opts.rows.map(r => buildRow(opts.kind, r));
  autoTable(doc, {
    startY,
    head: [heads], body,
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 8 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: 10, right: 10 },
  });

  // Totals
  const tot = opts.rows.reduce((acc, r) => {
    acc.billed += Number(r.gross_cargo_value || 0);
    acc.freight += Number(r.freight_amount || 0);
    acc.received += Number(r.received_amount || 0);
    return acc;
  }, { billed: 0, freight: 0, received: 0 });
  const finalY = (doc as any).lastAutoTable?.finalY || 30;
  doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text(
    `Cargas: ${opts.rows.length}   Faturado: ${money(tot.billed)}   Frete: ${money(tot.freight)}   Recebido: ${money(tot.received)}   Saldo: ${money(tot.freight - tot.received)}`,
    14, finalY + 8,
  );
  footer(doc); doc.save(filename);
}

function buildRow(kind: LoadReportKind, r: LoadControlRow): (string | number)[] {
  const balance = Number(r.freight_amount || 0) - Number(r.received_amount || 0);
  const daysLate = r.expected_payment_date
    ? Math.max(0, Math.floor((Date.now() - new Date(r.expected_payment_date + 'T00:00:00').getTime()) / 86400000))
    : 0;
  switch (kind) {
    case 'summary':
      return [
        dt(r.load_date), dt(r.arrival_date), r.external_load_number || r.load_number,
        money(r.gross_cargo_value), money(r.freight_amount),
        (r.cte_numbers || []).join(', '),
        r.payment_status || '', dt(r.expected_payment_date), dt(r.payment_date),
        money(balance), r.legacy_status_text || '',
      ];
    case 'detailed':
      return [
        r.external_load_number || r.load_number, r.client_name || '',
        money(r.gross_cargo_value), money(r.freight_amount),
        r.freight_percent == null ? '' : (Number(r.freight_percent) * 100).toFixed(2) + '%',
        r.total_weight_kg ?? '', r.invoice_count ?? 0, r.cte_count ?? 0,
        r.driver_name || '', r.plate || '',
      ];
    case 'open':
      return [
        r.external_load_number || r.load_number, r.client_name || '',
        money(r.freight_amount), dt(r.expected_payment_date), daysLate,
        (r.cte_numbers || []).join(', '), (r.legacy_status_text || '').slice(0, 60),
      ];
    case 'paid':
      return [
        r.external_load_number || r.load_number, r.client_name || '',
        money(r.freight_amount), money(r.received_amount),
        dt(r.payment_date), r.client_invoice_id || '', r.receivable_id || '',
      ];
    default:
      return [];
  }
}