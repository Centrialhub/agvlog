/// <reference lib="webworker" />
// Web Worker that builds the ingestion quality report PDF off the main thread.
// Used for large reports to keep the UI responsive.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import type { IngestionReport } from './ResultsStep';

export type PdfWorkerRequest = {
  type: 'generate';
  report: IngestionReport;
  generatedAtIso: string;
};

export type PdfWorkerResponse =
  | { type: 'progress'; stage: string; pct: number }
  | { type: 'done'; blob: Blob; filename: string; hashHex: string }
  | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const post = (msg: PdfWorkerResponse, transfer?: Transferable[]) => {
  if (transfer) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
};

async function buildPdf(report: IngestionReport, generatedAtIso: string) {
  const now = new Date(generatedAtIso);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) : '0.0');
  const fmtDate = (iso?: string | null) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('pt-BR');
  };

  post({ type: 'progress', stage: 'Calculando assinatura', pct: 10 });
  const canonical = JSON.stringify({
    totalDocs: report.totalDocs,
    savedDocs: report.savedDocs,
    errorDocs: report.errorDocs,
    needsReviewDocs: report.needsReviewDocs,
    clientsAutoCreated: report.clientsAutoCreated,
    clientsMatched: report.clientsMatched,
    clientsUnresolved: report.clientsUnresolved,
    reviewThreshold: report.reviewThreshold,
    fieldCoverage: report.fieldCoverage,
    reviewItems: report.reviewItems,
    auditMeta: report.auditMeta,
    generatedAt: now.toISOString(),
  });
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const shortHash = hashHex.slice(0, 16).toUpperCase();
  const verificationPayload = JSON.stringify({
    v: 1,
    sig: hashHex,
    ts: now.toISOString(),
    totals: {
      t: report.totalDocs,
      s: report.savedDocs,
      e: report.errorDocs,
      r: report.needsReviewDocs,
    },
  });
  const qrDataUrl = await QRCode.toDataURL(verificationPayload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
  });

  post({ type: 'progress', stage: 'Renderizando cabeçalho', pct: 25 });
  const meta = report.auditMeta || {};
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Relatório de qualidade da ingestão', margin, 50);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Gerado em ${now.toLocaleString('pt-BR')}`, margin, 66);
  if (report.reviewThreshold != null) {
    doc.text(`Threshold de revisão: < ${Math.round(report.reviewThreshold * 100)}%`, pageWidth - margin, 66, { align: 'right' });
  }
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 84,
    head: [['Auditoria', 'Detalhe']],
    body: [
      ['Empresa (tenant)', meta.tenantName || '-'],
      ['ID do tenant', meta.tenantId || '-'],
      ['Lote (batch_id)', meta.batchId || '-'],
      ['Origem do lote', meta.sourceLabel || '-'],
      ['Período de emissão dos documentos', `${fmtDate(meta.periodFrom)} → ${fmtDate(meta.periodTo)}`],
      ['Gerado em', meta.generatedAt ? new Date(meta.generatedAt).toLocaleString('pt-BR') : now.toLocaleString('pt-BR')],
    ],
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 180, textColor: [80, 80, 80] } },
    margin: { left: margin, right: margin },
  });

  post({ type: 'progress', stage: 'Renderizando resumos', pct: 45 });
  autoTable(doc, {
    head: [['Resumo', 'Valor', 'Total', '%']],
    body: [
      ['Documentos totais', String(report.totalDocs), String(report.totalDocs), '100.0%'],
      ['Documentos salvos', String(report.savedDocs), String(report.totalDocs), `${pct(report.savedDocs, report.totalDocs)}%`],
      ['Documentos com erro', String(report.errorDocs), String(report.totalDocs), `${pct(report.errorDocs, report.totalDocs)}%`],
      ['Marcados para revisão', String(report.needsReviewDocs), String(report.totalDocs), `${pct(report.needsReviewDocs, report.totalDocs)}%`],
      ['Clientes criados', String(report.clientsAutoCreated), String(report.totalDocs), `${pct(report.clientsAutoCreated, report.totalDocs)}%`],
      ['Clientes vinculados', String(report.clientsMatched), String(report.totalDocs), `${pct(report.clientsMatched, report.totalDocs)}%`],
      ['Clientes não resolvidos', String(report.clientsUnresolved), String(report.totalDocs), `${pct(report.clientsUnresolved, report.totalDocs)}%`],
    ],
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    margin: { left: margin, right: margin },
  });

  autoTable(doc, {
    head: [['Cobertura de campos', 'Preenchidos', 'Total', '%']],
    body: report.fieldCoverage.map(f => [
      f.label,
      String(f.filled),
      String(f.total),
      `${pct(f.filled, f.total)}%`,
    ]),
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [16, 122, 87], textColor: 255 },
    margin: { left: margin, right: margin },
  });

  if (report.reviewItems && report.reviewItems.length > 0) {
    post({ type: 'progress', stage: `Renderizando ${report.reviewItems.length} itens de revisão`, pct: 65 });
    autoTable(doc, {
      head: [['NF', 'Destinatário', 'Confiança', 'Motivos']],
      body: report.reviewItems.map(ri => [
        ri.invoiceNumber || '',
        ri.recipientName || '',
        ri.confidence != null ? `${Math.round(ri.confidence * 100)}%` : '-',
        ri.reasons.join(' • '),
      ]),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: [202, 138, 4], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 60 },
        2: { cellWidth: 55, halign: 'right' },
        3: { cellWidth: 220 },
      },
      margin: { left: margin, right: margin },
    });
  }

  post({ type: 'progress', stage: 'Aplicando rodapé e assinatura', pct: 85 });
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `Página ${i} de ${pageCount}`,
      pageWidth - margin,
      doc.internal.pageSize.getHeight() - 20,
      { align: 'right' }
    );
    doc.text(
      `Assinatura SHA-256: ${shortHash}…  •  Verifique escaneando o QR na última página`,
      margin,
      doc.internal.pageSize.getHeight() - 20
    );
  }

  doc.addPage();
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Verificação de autenticidade', margin, 60);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80);
  const intro = doc.splitTextToSize(
    'Este relatório possui uma assinatura digital (SHA-256) gerada a partir do conteúdo original. ' +
    'Para conferir a autenticidade, escaneie o QR code abaixo: ele contém o hash, data/hora e totais. ' +
    'Qualquer alteração no PDF invalida a assinatura.',
    pageWidth - margin * 2
  );
  doc.text(intro, margin, 84);

  const qrSize = 180;
  doc.addImage(qrDataUrl, 'PNG', margin, 140, qrSize, qrSize);

  doc.setFontSize(9);
  doc.setTextColor(40);
  const rightX = margin + qrSize + 24;
  let y = 150;
  const line = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.text(label, rightX, y);
    doc.setFont('helvetica', 'normal');
    const wrapped = doc.splitTextToSize(value, pageWidth - rightX - margin);
    doc.text(wrapped, rightX, y + 12);
    y += 12 + wrapped.length * 11 + 6;
  };
  line('Hash SHA-256', hashHex);
  line('Gerado em', now.toLocaleString('pt-BR'));
  line('Totais assinados', `${report.totalDocs} docs · ${report.savedDocs} salvos · ${report.errorDocs} erros · ${report.needsReviewDocs} revisão`);
  line('Como conferir', 'Recompute SHA-256 do JSON canônico do relatório (mesmos campos e ordem) e compare com o hash acima ou escaneado pelo QR.');

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    `Página ${pageCount + 1} de ${pageCount + 1}`,
    pageWidth - margin,
    doc.internal.pageSize.getHeight() - 20,
    { align: 'right' }
  );

  post({ type: 'progress', stage: 'Serializando PDF', pct: 95 });
  const blob = doc.output('blob');
  const ts = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `relatorio-ingestao-${ts}.pdf`;
  return { blob, filename, hashHex };
}

ctx.addEventListener('message', async (ev: MessageEvent<PdfWorkerRequest>) => {
  const msg = ev.data;
  if (!msg || msg.type !== 'generate') return;
  try {
    const { blob, filename, hashHex } = await buildPdf(msg.report, msg.generatedAtIso);
    post({ type: 'done', blob, filename, hashHex });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});