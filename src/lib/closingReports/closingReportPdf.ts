import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { BuiltItem, SummaryLine } from './closingReportBuilder';

const brl = (n: number) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kg = (n: number) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const dt = (v?: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '—');

export interface PdfOptions {
  title: string;
  companyName?: string;
  clientName?: string | null;
  periodStart: string;
  periodEnd: string;
  closingNumber?: string;
  items: BuiltItem[];
  summaryLines?: SummaryLine[];
  model?: 'summary' | 'detailed';
  notes?: string | null;
}

export function generateClosingReportPdf(opts: PdfOptions): jsPDF {
  const model = opts.model ?? 'detailed';
  const doc = new jsPDF({ orientation: model === 'summary' ? 'portrait' : 'landscape', unit: 'mm', format: 'a4' });

  // Header
  doc.setFontSize(14);
  doc.text(opts.companyName || 'AGVLog', 14, 15);
  doc.setFontSize(11);
  doc.text(opts.title, 14, 22);
  doc.setFontSize(9);
  const sub = [
    opts.closingNumber ? `Nº ${opts.closingNumber}` : null,
    `Período: ${dt(opts.periodStart)} a ${dt(opts.periodEnd)}`,
    opts.clientName ? `Cliente: ${opts.clientName}` : null,
  ].filter(Boolean).join('   |   ');
  doc.text(sub, 14, 28);

  const totalValor = opts.items.reduce((s, i) => s + i.invoice_value, 0);
  const totalPeso = opts.items.reduce((s, i) => s + i.weight_kg, 0);
  const totalFrete = opts.items.reduce((s, i) => s + i.freight_value, 0);

  doc.setFontSize(9);
  doc.text(`Peso: ${kg(totalPeso)} kg   Valor NF: ${brl(totalValor)}   Frete: ${brl(totalFrete)}   Notas: ${opts.items.length}`, 14, 34);

  if (model === 'summary') {
    const summary = opts.summaryLines ?? [];
    autoTable(doc, {
      startY: 40,
      head: [['Data Chegada', 'Faturamento', 'Peso Manifesto', 'Valor Faturado']],
      body: summary.map(s => [
        s.group_label,
        String(s.fiscal_document_count),
        kg(s.total_weight_kg),
        brl(s.total_invoice_value),
      ]),
      foot: [['TOTAIS', String(opts.items.length), kg(totalPeso), brl(totalValor)]],
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 41, 59] },
      footStyles: { fillColor: [226, 232, 240], textColor: 20 },
      showHead: 'everyPage',
    });
  } else {
    autoTable(doc, {
      startY: 40,
      head: [['Origem', 'Remetente', 'Destinatário', 'Destino', 'Emissão', 'Nota', 'CT-e', 'Valor NF', 'Peso', 'Frete', 'Entrega', 'Obs.']],
      body: opts.items.map(i => [
        i.origin_city ?? '',
        i.remitter_name ?? '',
        i.recipient_name ?? '',
        i.destination_city ?? '',
        dt(i.issue_date),
        i.invoice_number ?? '',
        i.cte_number ?? '',
        brl(i.invoice_value),
        kg(i.weight_kg),
        brl(i.freight_value),
        dt(i.delivery_date),
        i.observation ?? '',
      ]),
      foot: [['', '', '', '', '', '', 'TOTAIS', brl(totalValor), kg(totalPeso), brl(totalFrete), '', '']],
      styles: { fontSize: 7, cellPadding: 1, overflow: 'linebreak' },
      headStyles: { fillColor: [30, 41, 59] },
      footStyles: { fillColor: [226, 232, 240], textColor: 20, fontStyle: 'bold' },
      showHead: 'everyPage',
      columnStyles: {
        0: { cellWidth: 22 }, 1: { cellWidth: 32 }, 2: { cellWidth: 32 }, 3: { cellWidth: 22 },
        4: { cellWidth: 16 }, 5: { cellWidth: 14 }, 6: { cellWidth: 14 },
        7: { cellWidth: 20, halign: 'right' }, 8: { cellWidth: 18, halign: 'right' }, 9: { cellWidth: 20, halign: 'right' },
        10: { cellWidth: 16 }, 11: { cellWidth: 30 },
      },
    });
  }

  if (opts.notes) {
    const y = (doc as any).lastAutoTable?.finalY ?? 40;
    doc.setFontSize(8);
    doc.text('Observações: ' + opts.notes, 14, y + 6);
  }

  // Footer pagination
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(`Página ${i} de ${total}`, doc.internal.pageSize.getWidth() - 30, doc.internal.pageSize.getHeight() - 6);
  }
  return doc;
}

export function downloadClosingReportPdf(filename: string, opts: PdfOptions) {
  const doc = generateClosingReportPdf(opts);
  doc.save(filename);
}
