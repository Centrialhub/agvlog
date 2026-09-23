import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { csvSafeCell } from '@/lib/csvSafety';
import type { Tables } from '@/integrations/supabase/types';

export interface FieldCoverage {
  key: string;
  label: string;
  filled: number;
  total: number;
}

export interface ReviewItem {
  invoiceNumber: string | null;
  recipientName: string | null;
  reasons: string[];
}

export type IngestionReportRow = Omit<Tables<'ingestion_reports'>, 'field_coverage' | 'review_items'> & {
  field_coverage: FieldCoverage[];
  review_items: ReviewItem[];
};

type PdfWithAutoTable = jsPDF & { lastAutoTable: { finalY: number } };

export function buildIngestionReportCsv(r: IngestionReportRow): string {
  const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) : '0.0');
  const rows: unknown[][] = [
    ['Seção', 'Métrica', 'Valor', 'Total', 'Percentual'],
    ['Resumo', 'Documentos', r.total_docs, r.total_docs, '100.0'],
    ['Resumo', 'Salvos', r.saved_docs, r.total_docs, pct(r.saved_docs, r.total_docs)],
    ['Resumo', 'Erros', r.error_docs, r.total_docs, pct(r.error_docs, r.total_docs)],
    ['Resumo', 'needsReview', r.needs_review_docs, r.total_docs, pct(r.needs_review_docs, r.total_docs)],
    ['Clientes', 'Criados', r.clients_auto_created, r.total_docs, pct(r.clients_auto_created, r.total_docs)],
    ['Clientes', 'Vinculados', r.clients_matched, r.total_docs, pct(r.clients_matched, r.total_docs)],
    ['Clientes', 'Não resolvidos', r.clients_unresolved, r.total_docs, pct(r.clients_unresolved, r.total_docs)],
  ];
  for (const f of (r.field_coverage || [])) {
    rows.push(['Cobertura', f.label, f.filled, f.total, pct(f.filled, f.total)]);
  }
  if (Array.isArray(r.review_items) && r.review_items.length) {
    rows.push([]);
    rows.push(['Revisão', 'NF', 'Destinatário', 'Motivos']);
    for (const ri of r.review_items) {
      rows.push(['Revisão', ri.invoiceNumber, ri.recipientName || '', (ri.reasons || []).join(' | ')]);
    }
    const divg = aggregateDivergences(r.review_items);
    if (divg.length) {
      rows.push([]);
      rows.push(['Divergências', 'Motivo', 'Ocorrências', '% sobre revisões']);
      for (const d of divg) {
        rows.push(['Divergências', d.reason, d.count, pct(d.count, r.review_items.length)]);
      }
    }
  }
  return '\uFEFF' + rows.map(row => row.map(csvSafeCell).join(';')).join('\r\n');
}

function aggregateDivergences(items: ReviewItem[]): { reason: string; count: number }[] {
  const map = new Map<string, number>();
  for (const ri of items || []) {
    for (const r of (ri.reasons || [])) {
      map.set(r, (map.get(r) || 0) + 1);
    }
  }
  return Array.from(map.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export function downloadReportPdf(r: IngestionReportRow) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) + '%' : '0.0%');

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Relatório de Qualidade e Auditoria — Ingestão', 40, 40);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(110);
  doc.text(`Lote: ${r.batch_id}`, 40, 58);
  doc.text(`Gerado em: ${format(new Date(r.created_at), 'dd/MM/yyyy HH:mm')}`, 40, 70);
  if (r.source_label) doc.text(`Origem: ${r.source_label}`, 40, 82);
  doc.setTextColor(0);

  let y = 100;

  autoTable(doc, {
    startY: y,
    head: [['Indicador', 'Valor', '% sobre total']],
    body: [
      ['Documentos no lote', String(r.total_docs), '100,0%'],
      ['Salvos com sucesso', String(r.saved_docs), pct(r.saved_docs, r.total_docs)],
      ['Com erro', String(r.error_docs), pct(r.error_docs, r.total_docs)],
      ['Necessitam revisão', String(r.needs_review_docs), pct(r.needs_review_docs, r.total_docs)],
      ['Clientes criados', String(r.clients_auto_created), pct(r.clients_auto_created, r.total_docs)],
      ['Clientes vinculados', String(r.clients_matched), pct(r.clients_matched, r.total_docs)],
      ['Clientes sem match', String(r.clients_unresolved), pct(r.clients_unresolved, r.total_docs)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [40, 40, 40] },
    margin: { left: 40, right: 40 },
  });
  y = (doc as PdfWithAutoTable).lastAutoTable.finalY + 16;

  if (Array.isArray(r.field_coverage) && r.field_coverage.length) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Cobertura de campos', 40, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [['Campo', 'Preenchidos', 'Total', 'Cobertura']],
      body: r.field_coverage.map((f) => [
        f.label, String(f.filled), String(f.total), pct(f.filled, f.total),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [40, 40, 40] },
      margin: { left: 40, right: 40 },
    });
    y = (doc as PdfWithAutoTable).lastAutoTable.finalY + 16;
  }

  const divg = aggregateDivergences(Array.isArray(r.review_items) ? r.review_items : []);
  if (divg.length) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Divergências detectadas', 40, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [['Motivo', 'Ocorrências', '% sobre revisões']],
      body: divg.map(d => [d.reason, String(d.count), pct(d.count, (r.review_items || []).length)]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [180, 110, 0] },
      margin: { left: 40, right: 40 },
    });
    y = (doc as PdfWithAutoTable).lastAutoTable.finalY + 16;
  }

  if (Array.isArray(r.review_items) && r.review_items.length) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Documentos para revisão', 40, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [['NF', 'Destinatário', 'Motivos']],
      body: r.review_items.map((ri) => [
        String(ri.invoiceNumber ?? ''),
        String(ri.recipientName ?? ''),
        (ri.reasons || []).join(' • '),
      ]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [40, 40, 40] },
      columnStyles: { 2: { cellWidth: 'auto' } },
      margin: { left: 40, right: 40 },
    });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`Lote ${r.batch_id} · página ${i}/${pages}`, pageW - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
  }

  doc.save(`auditoria-ingestao-${r.batch_id}.pdf`);
}
