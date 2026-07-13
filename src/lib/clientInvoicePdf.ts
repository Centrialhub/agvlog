import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawCompanyHeader, type CompanyPdfInfo } from '@/lib/pdf/companyHeader';

export interface InvoiceDetail {
  emission_date?: string | null;
  document_number?: string | null;
  ort_number?: string | null;
  destination?: string | null;
  remitter?: string | null;
  recipient?: string | null;
  weight_kg?: number | null;
  cargo_value?: number | null;
  displayed_freight_value?: number | null;
}

export interface InvoiceCharge {
  source_type: 'cte_document' | 'nfse_document' | 'manual_service';
  source_number?: string | null;
  source_series?: string | null;
  reference_number?: string | null;
  issue_date?: string | null;
  description?: string | null;
  gross_amount: number;
  discount_amount?: number;
  ir_amount?: number;
  net_amount?: number;
  details?: InvoiceDetail[];
}

export interface InvoicePayload {
  invoice_number: string;
  issue_date: string;
  due_date?: string | null;
  gross_amount: number;
  discount_amount: number;
  interest_amount: number;
  total_amount: number;
  notes?: string | null;
  company: {
    name?: string;
    tax_id?: string;
    address?: string;
    phone?: string;
    email?: string;
    state_registration?: string;
    city?: string;
    state?: string;
    zip?: string;
    website?: string;
    logo_data_url?: string;
  };
  payer: {
    name?: string;
    tax_id?: string;
    address?: string;
    city?: string;
    state?: string;
  };
  charges: InvoiceCharge[];
}

const currency = (n: number | null | undefined) =>
  (Number(n || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDate = (s?: string | null) => {
  if (!s) return '';
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('pt-BR');
};

const weight = (n?: number | null) =>
  n == null ? '' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function generateClientInvoicePdf(payload: InvoicePayload): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 12;
  let y = 14;

  // Header (padronizado)
  const info: CompanyPdfInfo = {
    name: payload.company.name,
    taxId: payload.company.tax_id,
    stateRegistration: payload.company.state_registration,
    address: payload.company.address,
    city: payload.company.city,
    state: payload.company.state,
    zip: payload.company.zip,
    phone: payload.company.phone,
    email: payload.company.email,
    website: payload.company.website,
    logoDataUrl: payload.company.logo_data_url,
  };
  y = drawCompanyHeader(doc, info, { x: margin, y });

  // Invoice info box
  y += 2;
  const boxY = y;
  const boxH = 26;
  doc.setDrawColor(180);
  doc.rect(margin, boxY, pageW - margin * 2, boxH);

  const colW = (pageW - margin * 2) / 4;
  const label = (t: string, v: string, col: number, row: number) => {
    const x = margin + col * colW + 2;
    const yy = boxY + 5 + row * 10;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(90);
    doc.text(t, x, yy);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(0);
    doc.text(v, x, yy + 5);
  };
  label('FATURA Nº', payload.invoice_number, 0, 0);
  label('EMISSÃO', formatDate(payload.issue_date), 1, 0);
  label('VENCIMENTO', formatDate(payload.due_date), 2, 0);
  label('TOTAL', 'R$ ' + currency(payload.total_amount), 3, 0);
  label('BRUTO', 'R$ ' + currency(payload.gross_amount), 0, 1);
  label('DESCONTO', 'R$ ' + currency(payload.discount_amount), 1, 1);
  label('JUROS', 'R$ ' + currency(payload.interest_amount), 2, 1);
  label('Nº PARC.', '01', 3, 1);
  y = boxY + boxH + 3;

  // Payer
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('PAGADOR', margin, y); y += 4;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(payload.payer.name || '', margin, y); y += 4;
  const payerLine = [payload.payer.tax_id ? `CNPJ: ${payload.payer.tax_id}` : null, payload.payer.address, [payload.payer.city, payload.payer.state].filter(Boolean).join('/')]
    .filter(Boolean).join(' • ');
  if (payerLine) { doc.text(payerLine, margin, y); y += 5; }

  // Observação
  if (payload.notes) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('OBSERVAÇÃO', margin, y); y += 4;
    doc.setFont('helvetica', 'normal');
    const wrapped = doc.splitTextToSize(payload.notes, pageW - margin * 2);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 4 + 2;
  }

  y += 2;

  const ctes = payload.charges.filter(c => c.source_type === 'cte_document');
  const nfses = payload.charges.filter(c => c.source_type === 'nfse_document');
  const manuals = payload.charges.filter(c => c.source_type === 'manual_service');

  const sectionHeader = (title: string) => {
    if (y > 260) { doc.addPage(); y = 14; }
    doc.setFillColor(59, 130, 246);
    doc.setTextColor(255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.rect(margin, y, pageW - margin * 2, 6, 'F');
    doc.text(title, margin + 2, y + 4);
    doc.setTextColor(0);
    y += 7;
  };

  // CTRC / CT-e section
  if (ctes.length) {
    sectionHeader('CTRC / CT-e');
    const rows: any[] = [];
    for (const c of ctes) {
      if (c.details && c.details.length) {
        c.details.forEach((d, idx) => {
          rows.push([
            idx === 0 ? (c.source_number || '') : '',
            formatDate(d.emission_date),
            d.document_number || '',
            d.destination || '',
            d.remitter || '',
            weight(d.weight_kg),
            currency(d.cargo_value),
            currency(d.displayed_freight_value ?? c.gross_amount),
          ]);
        });
      } else {
        rows.push([c.source_number || '', formatDate(c.issue_date), '', '', '', '', '', currency(c.gross_amount)]);
      }
    }
    autoTable(doc, {
      startY: y,
      head: [['CTRC', 'Emissão', 'NF', 'Destino', 'Remetente', 'Peso', 'Valor NF', 'Frete']],
      body: rows,
      styles: { fontSize: 7, cellPadding: 1.2 },
      headStyles: { fillColor: [219, 234, 254], textColor: 20, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: margin, right: margin },
      foot: [['', '', '', '', '', 'SUBTOTAL', '', 'R$ ' + currency(ctes.reduce((s, c) => s + Number(c.gross_amount), 0))]],
      footStyles: { fillColor: [241, 245, 249], textColor: 0, fontStyle: 'bold' },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // NFS-e / ORT
  if (nfses.length) {
    sectionHeader('NFS-e / ORT');
    const rows: any[] = [];
    for (const c of nfses) {
      if (c.details && c.details.length) {
        c.details.forEach((d, idx) => {
          rows.push([
            idx === 0 ? (c.source_number || '') : '',
            formatDate(d.emission_date || c.issue_date),
            d.ort_number || d.document_number || '',
            d.destination || '',
            d.remitter || '',
            currency(d.cargo_value),
            currency(d.displayed_freight_value ?? c.gross_amount),
          ]);
        });
      } else {
        rows.push([c.source_number || '', formatDate(c.issue_date), '', '', c.description || '', '', currency(c.gross_amount)]);
      }
    }
    autoTable(doc, {
      startY: y,
      head: [['NFS-e', 'Emissão', 'ORT', 'Destino', 'Descrição', 'Valor', 'Total']],
      body: rows,
      styles: { fontSize: 7, cellPadding: 1.2 },
      headStyles: { fillColor: [219, 234, 254], textColor: 20, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: margin, right: margin },
      foot: [['', '', '', '', '', 'SUBTOTAL', 'R$ ' + currency(nfses.reduce((s, c) => s + Number(c.gross_amount), 0))]],
      footStyles: { fillColor: [241, 245, 249], textColor: 0, fontStyle: 'bold' },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // Manual services
  if (manuals.length) {
    sectionHeader('SERVIÇOS AVULSOS');
    const rows = manuals.map(c => [
      c.reference_number || c.source_number || '',
      formatDate(c.issue_date),
      c.description || '',
      currency(c.gross_amount),
    ]);
    autoTable(doc, {
      startY: y,
      head: [['Referência', 'Data', 'Descrição', 'Valor']],
      body: rows,
      styles: { fontSize: 7, cellPadding: 1.2 },
      headStyles: { fillColor: [219, 234, 254], textColor: 20, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: margin, right: margin },
      foot: [['', '', 'SUBTOTAL', 'R$ ' + currency(manuals.reduce((s, c) => s + Number(c.gross_amount), 0))]],
      footStyles: { fillColor: [241, 245, 249], textColor: 0, fontStyle: 'bold' },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // Final totals
  if (y > 260) { doc.addPage(); y = 14; }
  y += 4;
  doc.setDrawColor(180);
  doc.rect(pageW - margin - 90, y, 90, 26);
  const tx = pageW - margin - 88;
  const tv = pageW - margin - 4;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Valor bruto', tx, y + 5);
  doc.text('R$ ' + currency(payload.gross_amount), tv, y + 5, { align: 'right' });
  doc.text('(-) Desconto', tx, y + 11);
  doc.text('R$ ' + currency(payload.discount_amount), tv, y + 11, { align: 'right' });
  doc.text('(+) Juros', tx, y + 17);
  doc.text('R$ ' + currency(payload.interest_amount), tv, y + 17, { align: 'right' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('TOTAL FATURA', tx, y + 24);
  doc.text('R$ ' + currency(payload.total_amount), tv, y + 24, { align: 'right' });

  return doc;
}

/**
 * Totalizador de uma fatura a partir das cobranças.
 * Regra crítica: soma o gross de cada charge apenas uma vez,
 * mesmo quando o charge de CT-e tem várias linhas de detalhe (NFs).
 */
export function computeInvoiceTotals(
  charges: Pick<InvoiceCharge, 'gross_amount'>[],
  discount = 0,
  interest = 0,
) {
  const gross = charges.reduce((s, c) => s + Number(c.gross_amount || 0), 0);
  const total = gross - Number(discount || 0) + Number(interest || 0);
  return { gross, discount: Number(discount || 0), interest: Number(interest || 0), total };
}