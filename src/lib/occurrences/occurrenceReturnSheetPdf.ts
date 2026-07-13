import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReturnSheet } from '@/hooks/useOccurrenceReturnSheet';
import type { CompanyPdfInfo } from '@/lib/pdf/companyHeader';

function fmtDate(v: unknown): string {
  if (!v) return '—';
  try {
    const d = new Date(v as string);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('pt-BR');
  } catch {
    return String(v);
  }
}
function fmtDateTime(v: unknown): string {
  if (!v) return '—';
  try {
    const d = new Date(v as string);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString('pt-BR');
  } catch {
    return String(v);
  }
}
function fmtBRL(v: unknown): string {
  const n = typeof v === 'number' ? v : v ? Number(v) : NaN;
  if (!isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function s(v: unknown, fallback = '—'): string {
  if (v === null || v === undefined || v === '') return fallback;
  return String(v);
}

export interface BuildReturnSheetPdfOptions {
  sheet: ReturnSheet;
  companyName?: string;
  company?: CompanyPdfInfo;
}

export function buildReturnSheetPdf({ sheet, companyName, company: companyInfo }: BuildReturnSheetPdfOptions): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const occ = (sheet.occurrence_snapshot ?? {}) as Record<string, any>;
  const load = ((sheet.company_snapshot as any)?.load ?? {}) as Record<string, any>;
  const company = (sheet.company_snapshot ?? {}) as Record<string, any>;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;

  const drawHeader = () => {
    doc.setLineWidth(0.3);
    doc.rect(margin, margin, pageWidth - margin * 2, 12);
    // divisor for SAC block
    doc.line(pageWidth - margin - 45, margin, pageWidth - margin - 45, margin + 12);
    let textX = margin + 3;
    if (companyInfo?.logoDataUrl) {
      try {
        const fmt = companyInfo.logoDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        doc.addImage(companyInfo.logoDataUrl, fmt, margin + 1, margin + 1, 12, 10, undefined, 'FAST');
        textX = margin + 15;
      } catch { /* ignore */ }
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    const displayName = companyInfo?.name || companyInfo?.legalName || companyName || company.name || 'AGV DISTRIBUIÇÃO E LOGÍSTICA LTDA';
    doc.text(s(displayName), textX, margin + 6);
    const metaParts = [
      companyInfo?.taxId ? `CNPJ ${companyInfo.taxId}` : '',
      [companyInfo?.city, companyInfo?.state].filter(Boolean).join('/'),
      companyInfo?.phone || '',
    ].filter(Boolean).join(' • ');
    if (metaParts) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(80);
      doc.text(metaParts, textX, margin + 10, { maxWidth: pageWidth - margin * 2 - 60 });
      doc.setTextColor(0);
    }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`SAC ${s(sheet.sac_number || sheet.sheet_number, '-')}`, pageWidth - margin - 42, margin + 8);
  };

  drawHeader();

  // Top block: Data Abertura, Encerramento, Romaneio, Placa, Conferente, Ajudante
  let y = margin + 16;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const label = (text: string, x: number, yy: number) => {
    doc.setFont('helvetica', 'bold'); doc.text(text, x, yy);
  };
  const value = (text: string, x: number, yy: number) => {
    doc.setFont('helvetica', 'normal'); doc.text(text, x, yy);
  };

  label('Data Abertura:', margin, y);
  value(fmtDateTime(occ.occurrence_date), margin + 26, y);
  label('Romaneio:', margin + 78, y);
  value(s(load.load_number), margin + 96, y);
  label('Conferente:', margin + 130, y);
  value(s(load.conferente, ''), margin + 150, y);

  y += 5;
  label('Data Encerramento:', margin, y);
  value(fmtDateTime(occ.closed_at || occ.resolved_at), margin + 32, y);
  label('Placa:', margin + 78, y);
  value(s(load.vehicle_plate || load.trailer_plate), margin + 90, y);
  label('Ajudante:', margin + 130, y);
  value(s(load.helper, ''), margin + 148, y);

  y += 4;
  doc.setLineWidth(0.2); doc.line(margin, y, pageWidth - margin, y);

  // Ocorrência block
  y += 4;
  const occBoxTop = y;
  doc.rect(margin, occBoxTop, pageWidth - margin * 2, 32);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Ocorrência 1', margin + 2, occBoxTop + 4);
  const yy0 = occBoxTop + 9;
  const col1 = margin + 2;
  const col2 = margin + 105;
  label('Assunto:', col1, yy0); value(s(occ.occurrence_type).toUpperCase(), col1 + 16, yy0);
  label('Motorista:', col2, yy0); value(s(load.driver_name).toUpperCase(), col2 + 20, yy0);
  label('Ocorrência:', col1, yy0 + 5); value(s(occ.occurrence_reason).toUpperCase(), col1 + 20, yy0 + 5);
  label('Data:', col2, yy0 + 5); value(fmtDate(occ.occurrence_date), col2 + 12, yy0 + 5);
  label('Solução:', col1, yy0 + 10); value(s(occ.resolution_type).toUpperCase(), col1 + 16, yy0 + 10);
  label('Senha:', col2, yy0 + 10); value(s(occ.password_or_authorization, ''), col2 + 14, yy0 + 10);
  label('Observação:', col1, yy0 + 15);
  const notes = s(occ.resolution_notes || occ.occurrence_description, '');
  const wrapped = doc.splitTextToSize(notes, pageWidth - margin * 2 - 30);
  doc.setFont('helvetica', 'normal');
  doc.text(wrapped.slice(0, 2), col1 + 22, yy0 + 15);

  y = occBoxTop + 34;

  // Notas fiscais
  autoTable(doc, {
    startY: y,
    head: [['Nº Nota', 'Fornecedor', 'Cliente', 'Data Emissão']],
    body: (sheet.invoice_snapshot ?? []).map((inv: any) => [
      s(inv.invoice_number),
      s(inv.remitter),
      s(inv.recipient),
      fmtDate(inv.issue_date),
    ]),
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.2, textColor: 20 },
    headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold' },
    margin: { left: margin, right: margin },
    didDrawPage: () => { /* header re-drawn separately */ },
  });

  // Produtos com problema
  const yProducts = (doc as any).lastAutoTable.finalY + 3;
  autoTable(doc, {
    startY: yProducts,
    head: [[
      'Nº Nota', 'Ite', 'Código', 'Descrição', 'UM',
      'Qtd.', 'Valor', 'Qt.Prob.', 'Tipo', 'Nº NFD', 'Vlr.Oco', 'Observação',
    ]],
    body: (sheet.product_snapshot ?? []).map((p: any, idx: number) => [
      s(p.invoice_number),
      String(idx + 1),
      s(p.product_code),
      s(p.product_description),
      s(p.unit),
      s(p.quantity ?? p.quantity_text),
      fmtBRL(p.item_value),
      s(p.quantity_problem ?? p.quantity),
      s(p.return_type),
      s((p as any).nfd_number, ''),
      fmtBRL(p.occurrence_value ?? p.item_value),
      s(p.notes),
    ]),
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 1, textColor: 20, overflow: 'linebreak' },
    headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 14 }, 1: { cellWidth: 6 }, 2: { cellWidth: 14 },
      3: { cellWidth: 42 }, 4: { cellWidth: 8 }, 5: { cellWidth: 10 },
      6: { cellWidth: 16 }, 7: { cellWidth: 12 }, 8: { cellWidth: 14 },
      9: { cellWidth: 12 }, 10: { cellWidth: 16 },
    },
    margin: { left: margin, right: margin },
    didDrawPage: () => drawHeader(),
  });

  const yEnd = (doc as any).lastAutoTable.finalY + 12;
  const pageH = doc.internal.pageSize.getHeight();
  const footY = Math.min(Math.max(yEnd, pageH - 40), pageH - 30);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.line(margin + 10, footY, margin + 90, footY);
  doc.text('Assinatura / Recebimento', margin + 25, footY + 4);
  doc.line(pageWidth - margin - 70, footY, pageWidth - margin - 10, footY);
  doc.text('Data', pageWidth - margin - 45, footY + 4);
  if (sheet.receiver_name) {
    doc.text(`Recebedor: ${sheet.receiver_name}`, margin + 10, footY + 10);
  }

  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(`Página ${i} de ${pageCount}`, pageWidth - margin - 30, pageH - 5);
  }

  return doc;
}

export function downloadReturnSheetPdf(sheet: ReturnSheet, companyName?: string, company?: CompanyPdfInfo): void {
  const doc = buildReturnSheetPdf({ sheet, companyName, company });
  const filename = `folha-devolucao-${sheet.sheet_number}.pdf`;
  doc.save(filename);
}

export function openReturnSheetPdfPrint(sheet: ReturnSheet, companyName?: string, company?: CompanyPdfInfo): void {
  const doc = buildReturnSheetPdf({ sheet, companyName, company });
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (w) setTimeout(() => w.print(), 800);
}