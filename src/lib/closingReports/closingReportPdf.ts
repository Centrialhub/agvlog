import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { BuiltItem, SummaryLine } from './closingReportBuilder';
import { drawCompanyHeader, type CompanyPdfInfo } from '@/lib/pdf/companyHeader';
import { getAutoTableFinalY } from '@/lib/pdf/autoTable';

const brl = (n: number) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kg = (n: number) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const dt = (v?: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '—');
const dtTs = (v?: string | null) => {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10).split('-').reverse().join('/');
  return '';
};
const tm = (v?: string | null) => {
  if (!v) return '';
  const s = String(v);
  if (s.includes('T') && s.length >= 16) return s.slice(11, 16);
  return '';
};
const n2 = (n: unknown) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface PdfOptions {
  title: string;
  companyName?: string;
  company?: CompanyPdfInfo;
  clientName?: string | null;
  periodStart: string;
  periodEnd: string;
  closingNumber?: string;
  items: BuiltItem[];
  summaryLines?: SummaryLine[];
  model?: 'summary' | 'detailed' | 'trips';
  notes?: string | null;
}

export function generateClosingReportPdf(opts: PdfOptions): jsPDF {
  const model = opts.model ?? 'detailed';
  const doc = new jsPDF({ orientation: model === 'summary' ? 'portrait' : 'landscape', unit: 'mm', format: 'a4' });

  // Header
  const info: CompanyPdfInfo = opts.company ?? { name: opts.companyName || 'AGVLog' };
  const headerY = drawCompanyHeader(doc, info, { y: 12 });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(opts.title, 14, headerY + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const sub = [
    opts.closingNumber ? `Nº ${opts.closingNumber}` : null,
    `Período: ${dt(opts.periodStart)} a ${dt(opts.periodEnd)}`,
    opts.clientName ? `Cliente: ${opts.clientName}` : null,
  ].filter(Boolean).join('   |   ');
  doc.text(sub, 14, headerY + 10);

  const totalValor = opts.items.reduce((s, i) => s + i.invoice_value, 0);
  const totalPeso = opts.items.reduce((s, i) => s + i.weight_kg, 0);
  const totalFrete = opts.items.reduce((s, i) => s + i.freight_value, 0);

  doc.setFontSize(9);
  doc.text(`Peso: ${kg(totalPeso)} kg   Valor NF: ${brl(totalValor)}   Frete: ${brl(totalFrete)}   Notas: ${opts.items.length}`, 14, headerY + 16);
  const tableStart = headerY + 22;

  if (model === 'summary') {
    const summary = opts.summaryLines ?? [];
    autoTable(doc, {
      startY: tableStart,
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
    if (model === 'trips') {
      // Deduplicate by load_id (one row per viagem)
      const seen = new Set<string>();
      const trips: BuiltItem[] = [];
      for (const i of opts.items) {
        const k = i.load_id || `nf-${i.fiscal_document_id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        trips.push(i);
      }
      const tot = { km: 0, l: 0, val: 0 };
      const body = trips.map((i) => {
        const km = Number(i.km_driven || 0);
        const l = Number(i.fuel_liters || 0);
        const v = Number(i.fuel_total || 0);
        tot.km += km; tot.l += l; tot.val += v;
        return [
          i.route_label ?? i.destination_city ?? '',
          i.route_complement ?? i.origin_city ?? '',
          i.driver_name ?? '',
          i.vehicle_plate ?? '',
          dtTs(i.departure_at), tm(i.departure_at),
          dtTs(i.arrival_at_ts ?? i.arrival_date), tm(i.arrival_at_ts),
          i.days_count ?? '',
          i.km_initial != null ? n2(i.km_initial) : '',
          i.km_final != null ? n2(i.km_final) : '',
          km ? n2(km) : '',
          l ? n2(l) : '',
          i.fuel_unit_price != null ? n2(i.fuel_unit_price) : '',
          v ? n2(v) : '',
          i.consumption_km_l ? n2(i.consumption_km_l) : '',
        ];
      });
      autoTable(doc, {
        startY: tableStart,
        head: [[
          'Rota', 'Complemento', 'Motorista', 'Placa',
          'Data Saída', 'H. Saída', 'Data Chegada', 'H. Chegada',
          'Dias', 'KM Ini', 'KM Fim', 'KM Rodado',
          'Litros', 'R$/L', 'Total Comb.', 'km/L',
        ]],
        body,
        foot: [[
          'TOTAIS', '', '', '', '', '', '', '', '', '', '',
          tot.km ? n2(tot.km) : '', tot.l ? n2(tot.l) : '', '', tot.val ? n2(tot.val) : '',
          tot.l > 0 ? n2(tot.km / tot.l) : '',
        ]],
        styles: { fontSize: 7, cellPadding: 1, overflow: 'linebreak' },
        headStyles: { fillColor: [30, 41, 59] },
        footStyles: { fillColor: [226, 232, 240], textColor: 20, fontStyle: 'bold' },
        showHead: 'everyPage',
      });
    } else {
    autoTable(doc, {
      startY: tableStart,
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
  }

  if (opts.notes) {
    const y = getAutoTableFinalY(doc, 40);
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
