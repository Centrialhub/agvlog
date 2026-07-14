import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { PalletProtocol } from '@/hooks/usePalletReturns';

function fmtDate(v: string | null | undefined): string {
  if (!v) return '';
  const s = String(v);
  // Datas apenas (YYYY-MM-DD) — evita shift de fuso horário
  const isoDay = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDay) {
    const [, y, m, d] = isoDay;
    return `${d}/${m}/${y}`;
  }
  // Datas com horário (ISO completo) — usa componentes locais
  const isoFull = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoFull) {
    const [, y, m, d] = isoFull;
    return `${d}/${m}/${y}`;
  }
  const d2 = new Date(s);
  if (isNaN(d2.getTime())) return s;
  return d2.toLocaleDateString('pt-BR');
}

export interface PalletProtocolPdfOptions {
  companyName?: string;
  tenantName?: string;
  companyLegalName?: string;
  companyTradeName?: string;
  companyTaxId?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  logoDataUrl?: string;
}

/** Gera o PDF do protocolo, seguindo o layout da planilha legada. */
export function generatePalletReturnProtocolPdf(protocol: PalletProtocol, options: PalletProtocolPdfOptions = {}): Blob {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const company =
    options.companyLegalName ||
    options.companyTradeName ||
    options.companyName ||
    options.tenantName ||
    'AGV DISTRIBUIÇÃO E LOGÍSTICA';
  const supplier = protocol.supplier_name_snapshot || '';

  // Cabeçalho: logo à esquerda + títulos deslocados para não sobrepor
  const hasLogo = !!options.logoDataUrl;
  const titleLeftMargin = hasLogo ? 46 : 14; // espaço reservado para o logo
  const titleCenterX = hasLogo ? (titleLeftMargin + 196) / 2 : 105;
  const titleMaxWidth = 196 - titleLeftMargin;

  if (hasLogo) {
    try {
      const fmt = options.logoDataUrl!.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(options.logoDataUrl!, fmt, 14, 12, 28, 20, undefined, 'FAST');
    } catch { /* ignore logo failure */ }
  }

  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(`DEVOLUÇÃO DE PALETES P/ ${supplier.toUpperCase()}`, titleCenterX, 18, { align: 'center', maxWidth: titleMaxWidth });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`DEVOLUÇÃO DA ${company.toUpperCase()} P/ ${supplier.toUpperCase()}`, titleCenterX, 25, { align: 'center', maxWidth: titleMaxWidth });

  // Linha com dados da empresa emissora
  doc.setFontSize(8);
  doc.setTextColor(90);
  const companyMeta = [
    options.companyTaxId ? `CNPJ ${options.companyTaxId}` : '',
    options.companyAddress || '',
    options.companyPhone || '',
    options.companyEmail || '',
  ].filter(Boolean).join('  •  ');
  if (companyMeta) doc.text(companyMeta, titleCenterX, 31, { align: 'center', maxWidth: titleMaxWidth });
  doc.setTextColor(0);

  // Linha divisória
  doc.setDrawColor(180);
  doc.line(14, 38, 196, 38);
  doc.setDrawColor(0);

  doc.setFontSize(10);
  doc.text(`Protocolo: ${protocol.protocol_number}`, 14, 46);
  if (protocol.returned_at) doc.text(`Data devolução: ${fmtDate(protocol.returned_at)}`, 14, 52);
  doc.text(`Data: ${fmtDate(protocol.issue_date)}`, 196, 46, { align: 'right' });

  const bodyStart = protocol.returned_at ? 58 : 54;

  autoTable(doc, {
    startY: bodyStart,
    head: [['TIPO / COR', 'QTD']],
    body: [
      ...(protocol.items || []).map((it) => [
        `${it.pallet_type_code}${it.pallet_color ? ' - ' + it.pallet_color : ''}${it.pallet_type_name && it.pallet_type_name !== it.pallet_type_code ? ' (' + it.pallet_type_name + ')' : ''}`,
        String(it.quantity),
      ]),
      ['TOTAL', String(protocol.total_quantity || 0)],
    ],
    styles: { fontSize: 11, cellPadding: 3 },
    headStyles: { fillColor: [40, 40, 40], textColor: 255 },
    columnStyles: { 1: { halign: 'right', cellWidth: 40 } },
    theme: 'grid',
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index === (protocol.items?.length || 0)) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [230, 230, 230];
      }
    },
  });

  let y = (doc as any).lastAutoTable.finalY + 12;
  doc.setFontSize(10);
  doc.text(`Recebemos de: ${company.toUpperCase()} a quantidade de paletes total relacionada acima.`, 14, y, { maxWidth: 180 });
  y += 20;

  // Signature block
  doc.line(14, y, 110, y);
  doc.line(120, y, 196, y);
  doc.setFontSize(9);
  doc.text('ASSINATURA / NOME', 14, y + 5);
  doc.text('DATA', 120, y + 5);
  if (protocol.receiver_name) doc.text(protocol.receiver_name, 14, y - 2);
  if (protocol.signature_date) doc.text(fmtDate(protocol.signature_date), 120, y - 2);

  y += 16;
  doc.setFontSize(9);
  doc.setTextColor(90);
  const meta: string[] = [];
  if (protocol.driver_name_snapshot) meta.push(`Motorista: ${protocol.driver_name_snapshot}`);
  if (protocol.vehicle_plate_snapshot) meta.push(`Placa: ${protocol.vehicle_plate_snapshot}`);
  if (protocol.load_id) meta.push(`Carga: ${protocol.load_id}`);
  if (meta.length) doc.text(meta.join('   |   '), 14, y);
  if (protocol.notes) doc.text(`Observações: ${protocol.notes}`, 14, y + 6, { maxWidth: 180 });

  const pageCount = (doc as any).internal.getNumberOfPages?.() || 1;
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Página ${i} de ${pageCount}`, 196, 290, { align: 'right' });
  }
  return doc.output('blob');
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generatePalletReportPdf(title: string, headers: string[], rows: Array<Array<string | number | null | undefined>>, meta: { tenantName?: string; filters?: string; totals?: Array<[string, string | number]> }): Blob {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14);
  doc.text(title, 14, 14);
  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(`${meta.tenantName || ''}  •  Emitido em ${new Date().toLocaleString('pt-BR')}  •  ${rows.length} registro(s)`, 14, 20);
  if (meta.filters) doc.text(`Filtros: ${meta.filters}`, 14, 26);
  autoTable(doc, {
    startY: meta.filters ? 32 : 28,
    head: [headers],
    body: rows.map((r) => r.map((v) => (v == null ? '' : String(v)))),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [40, 40, 40], textColor: 255 },
  });
  if (meta.totals?.length) {
    let y = (doc as any).lastAutoTable.finalY + 6;
    doc.setFontSize(9); doc.setTextColor(20);
    for (const [k, v] of meta.totals) { doc.text(`${k}: ${v}`, 14, y); y += 5; }
  }
  const pageCount = (doc as any).internal.getNumberOfPages?.() || 1;
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Página ${i} de ${pageCount}`, 285, 205, { align: 'right' });
  }
  return doc.output('blob');
}