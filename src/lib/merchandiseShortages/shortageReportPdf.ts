import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ShortageReportRow, GroupedShortageReport } from './shortageReportBuilder';
import { groupReport, totalOf } from './shortageReportBuilder';
import { monthLabel, formatBRL } from './shortageCalculator';
import { drawCompanyHeader, type CompanyPdfInfo } from '@/lib/pdf/companyHeader';
import { fmtDateSafe } from '@/lib/utils/formatDate';

export interface ShortagePdfOptions {
  companyName?: string;
  company?: CompanyPdfInfo;
  month?: number;
  year?: number;
  groupBy?: 'company' | 'driver' | 'observation' | 'week' | 'none';
}

function fmtDate(v: string | null | undefined): string {
  return fmtDateSafe(v, '');
}
function fmtBR(n: number | null | undefined): string {
  if (n == null) return '-';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function generateMonthlyShortageReportPdf(rows: ShortageReportRow[], options: ShortagePdfOptions = {}): Blob {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const info: CompanyPdfInfo = options.company ?? { name: options.companyName || 'AGV DISTRIBUIÇÃO E LOGÍSTICA' };
  const title = 'CONTROLE MENSAL - FALTA DE MERCADORIA';
  const period = options.month && options.year ? monthLabel(options.month, options.year) : '';

  const afterHeader = drawCompanyHeader(doc, info, { y: 10 });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(title, 148, 14, { align: 'center' });
  if (period) {
    doc.setFontSize(11);
    doc.text(period, 148, 20, { align: 'center' });
  }
  doc.setFont('helvetica', 'normal');

  const groups: GroupedShortageReport[] = groupReport(rows, options.groupBy ?? 'none');
  const head = [['Data','Empresa','Motorista','NF','Cidade','Cliente','Descrição do Produto','Qtd','Custo Un.','Total (R$)','Observação']];
  let startY = Math.max(afterHeader + 4, 26);
  for (const g of groups) {
    if (options.groupBy && options.groupBy !== 'none') {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(g.groupKey, 14, startY);
      startY += 4;
    }
    const body = g.rows.map(r => [
      fmtDate(r.occurrence_date),
      r.company_name ?? '', r.driver_name ?? '', r.invoice_number ?? '',
      r.city ?? '', r.customer_name ?? '', r.product_description ?? '',
      r.quantity_text ?? (r.quantity != null ? String(r.quantity) : ''),
      fmtBR(r.unit_cost), fmtBR(r.total_amount), r.observation ?? '',
    ]);
    body.push(['', '', '', '', '', '', '', '', 'Subtotal', fmtBR(g.subtotal), '']);
    autoTable(doc, {
      startY,
      head, body,
      styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
      headStyles: { fillColor: [138, 176, 91], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 18 }, 1: { cellWidth: 26 }, 2: { cellWidth: 30 }, 3: { cellWidth: 14 },
        4: { cellWidth: 26 }, 5: { cellWidth: 34 }, 6: { cellWidth: 44 }, 7: { cellWidth: 14 },
        8: { cellWidth: 18, halign: 'right' }, 9: { cellWidth: 18, halign: 'right' }, 10: { cellWidth: 34 },
      },
      margin: { left: 14, right: 14 },
    });
    // @ts-expect-error lastAutoTable is attached by autoTable
    startY = (doc.lastAutoTable?.finalY ?? startY) + 6;
  }

  // Grand total
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL GERAL: ${formatBRL(totalOf(rows))}   |   Itens: ${rows.length}`, 14, startY + 4);

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Página ${i} de ${pageCount}`, 280, 200, { align: 'right' });
  }
  return doc.output('blob');
}
