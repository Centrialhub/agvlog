import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawCompanyHeader, type CompanyPdfInfo } from '@/lib/pdf/companyHeader';

const brl = (n?: number | null) =>
  n == null ? '' : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (v?: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '');

export interface UnservedRowPdf {
  invoice_number?: string | null;
  customer_name?: string | null;
  city?: string | null;
  invoice_issue_date?: string | null;
  invoice_value?: number | null;
  supplier_name?: string | null;
  notes?: string | null;
  arrival_date?: string | null;
  expected_delivery?: string | null;
  responsible?: string | null;
  is_rural?: boolean;
}

export interface UnservedPdfOptions {
  title: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  clientName?: string | null;
  supplierName?: string | null;
  companyName?: string;
  company?: CompanyPdfInfo;
  filtersLabel?: string;
  rows: UnservedRowPdf[];
}

export function generateUnservedNotesPdf(opts: UnservedPdfOptions): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const info: CompanyPdfInfo = opts.company ?? { name: opts.companyName || 'AGVLog' };
  const afterHeader = drawCompanyHeader(doc, info, { y: 10 });
  doc.setFontSize(12); doc.setFont('helvetica', 'bold');
  doc.text(opts.title, 14, afterHeader + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const sub = [
    opts.clientName ? `Cliente: ${opts.clientName}` : null,
    opts.supplierName ? `Fornecedor: ${opts.supplierName}` : null,
    opts.periodStart && opts.periodEnd ? `Semana: ${dt(opts.periodStart)} a ${dt(opts.periodEnd)}` : null,
    opts.filtersLabel,
  ].filter(Boolean).join('   |   ');
  if (sub) doc.text(sub, 14, afterHeader + 10);
  const tableStart = afterHeader + 14;

  autoTable(doc, {
    startY: tableStart,
    head: [['NF', 'Cliente', 'Cidade', 'Data NF', 'Valor', 'Fornecedor', 'Zona Rural', 'Observação']],
    body: opts.rows.map((r) => [
      r.invoice_number ?? '',
      r.customer_name ?? '',
      r.city ?? '',
      dt(r.invoice_issue_date),
      brl(r.invoice_value ?? 0),
      r.supplier_name ?? '',
      r.is_rural ? 'Sim' : '',
      r.notes ?? '',
    ]),
    styles: { fontSize: 8, cellPadding: 1.2, overflow: 'linebreak' },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: { 7: { cellWidth: 55 } },
  });

  const total = opts.rows.reduce((s, r) => s + Number(r.invoice_value || 0), 0);
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  doc.setFontSize(9);
  doc.text(`Total: ${brl(total)}   Notas: ${opts.rows.length}`, 14, finalY);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(`Página ${i} de ${pages}`, doc.internal.pageSize.getWidth() - 30, doc.internal.pageSize.getHeight() - 6);
  }
  return doc;
}
