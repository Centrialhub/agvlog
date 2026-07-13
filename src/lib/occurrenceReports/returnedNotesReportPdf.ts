import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawCompanyHeader, type CompanyPdfInfo } from '@/lib/pdf/companyHeader';

const brl = (n?: number | null) =>
  n == null ? '' : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface ReturnedRowPdf {
  section: 'returns' | 'collection' | 'shortages' | 'surplus';
  customer_name?: string | null;
  city?: string | null;
  occurrence_number?: string | null;
  invoice_number?: string | null;
  return_type?: string | null;
  invoice_value?: number | null;
  reason?: string | null;
  quantity_text?: string | null;
  product_description?: string | null;
  password_or_authorization?: string | null;
}

export interface ReturnedPdfOptions {
  title: string;
  clientName?: string | null;
  supplierName?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  referenceDate?: string | null;
  companyName?: string;
  company?: CompanyPdfInfo;
  rows: ReturnedRowPdf[];
}

const sectionOrder: ReturnedRowPdf['section'][] = ['returns', 'collection', 'shortages', 'surplus'];
const sectionLabels: Record<ReturnedRowPdf['section'], string> = {
  returns: 'DEVOLUÇÕES',
  collection: 'COLETAS',
  shortages: 'FALTAS ENCONTRADAS',
  surplus: 'SOBRAS',
};

export function generateReturnedNotesPdf(opts: ReturnedPdfOptions): jsPDF {
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
    opts.referenceDate ? `Referência: ${opts.referenceDate}` : null,
    opts.periodStart && opts.periodEnd ? `Período: ${opts.periodStart} a ${opts.periodEnd}` : null,
  ].filter(Boolean).join('   |   ');
  if (sub) doc.text(sub, 14, afterHeader + 10);
  let cursorY = afterHeader + 16;
  for (const section of sectionOrder) {
    const items = opts.rows.filter((r) => r.section === section);
    if (!items.length) continue;
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text(sectionLabels[section], 14, cursorY);
    doc.setFont(undefined, 'normal');
    autoTable(doc, {
      startY: cursorY + 2,
      head: [['Cliente', 'Cidade', 'Nº Ocorrência', 'NF', 'Tipo', 'Valor', 'Motivo', 'QTD', 'Descrição', 'Senha']],
      body: items.map((r) => [
        r.customer_name ?? '',
        r.city ?? '',
        r.occurrence_number ?? '',
        r.invoice_number ?? '',
        r.return_type ?? '',
        brl(r.invoice_value ?? 0),
        r.reason ?? '',
        r.quantity_text ?? '',
        r.product_description ?? '',
        r.password_or_authorization ?? '',
      ]),
      styles: { fontSize: 7, cellPadding: 1.2, overflow: 'linebreak' },
      headStyles: { fillColor: [30, 41, 59] },
      columnStyles: { 8: { cellWidth: 60 } },
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  const total = opts.rows.reduce((s, r) => s + Number(r.invoice_value || 0), 0);
  doc.setFontSize(9);
  doc.text(`Total: ${brl(total)}   Linhas: ${opts.rows.length}`, 14, cursorY);
  doc.text('Ass: ______________________________     Data: ____/____/______', 14, cursorY + 12);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(`Página ${i} de ${pages}`, doc.internal.pageSize.getWidth() - 30, doc.internal.pageSize.getHeight() - 6);
  }
  return doc;
}
