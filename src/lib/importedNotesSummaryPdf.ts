import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { RowInput } from 'jspdf-autotable';
import type { ImportedNoteRow } from '@/hooks/useImportedNotesSummary';
import { getImportedNoteSummaryTotals, groupNotesBy } from '@/hooks/useImportedNotesSummary';
import { getAutoTableFinalY } from '@/lib/pdf/autoTable';

export interface CarrierInfo {
  name: string;
  cnpj?: string;
  ie?: string;
  address?: string;
  phone?: string;
  city?: string;
  state?: string;
  email?: string;
  website?: string;
  logo_data_url?: string;
}

export interface ManifestInfo {
  manifestNumber?: string | null;
  vehiclePlate?: string | null;
  vehicleBrand?: string | null;
  vehicleCity?: string | null;
  vehicleState?: string | null;
  vehicleOwner?: string | null;
  vehicleAddress?: string | null;
  driverName?: string | null;
  origin?: string | null;
  destination?: string | null;
}

export type SummaryReportType = 'destination_summary' | 'origin_summary' | 'raw_list';

export interface ReportOptions {
  reportType: SummaryReportType;
  carrier: CarrierInfo;
  manifest?: ManifestInfo | null;
  rows: ImportedNoteRow[];
  generatedAt?: Date;
}

const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num3 = (n: number) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const dt = (value: unknown) => value
  ? new Date(String(value).length <= 10 ? `${String(value)}T00:00:00` : String(value)).toLocaleDateString('pt-BR')
  : '';

const TABLE_HEAD = [
  'Origem','Remetente','Destinatário','Destino','Emissão','Nº Nota',
  'Valor Nota','Volume','Peso','Valor CIF','Valor FOB','Nº CT-e',
];

function rowToTuple(r: ImportedNoteRow) {
  return [
    r.origin_city || '—',
    (r.remitter || '—').slice(0, 30),
    (r.recipient || '—').slice(0, 30),
    r.recipient_city || '—',
    dt(r.issue_date),
    r.invoice_number || '',
    brl(Number(r.value || 0)),
    num3(Number(r.volume_count ?? r.pallet_count ?? 0)),
    num3(Number(r.weight_kg || 0)),
    brl(Number(r.freight_cif_value ?? r.freight_value ?? 0)),
    brl(Number(r.freight_fob_value || 0)),
    r.cte_number || '',
  ];
}

export function generateImportedNotesSummaryPdf(opts: ReportOptions) {
  const { reportType, carrier, manifest, rows } = opts;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const generatedAt = opts.generatedAt ?? new Date();

  const drawHeader = () => {
    let textX = 14;
    if (carrier.logo_data_url) {
      try {
        const fmt = carrier.logo_data_url.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        doc.addImage(carrier.logo_data_url, fmt, 14, 6, 18, 14, undefined, 'FAST');
        textX = 34;
      } catch { /* ignore */ }
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text(carrier.name || 'Transportadora', textX, 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(80);
    const cityUf = [carrier.city, carrier.state].filter(Boolean).join('/');
    const infoLine1 = [
      carrier.cnpj ? `CNPJ ${carrier.cnpj}` : null,
      carrier.ie ? `IE ${carrier.ie}` : null,
      carrier.address, cityUf,
    ].filter(Boolean).join(' • ');
    const infoLine2 = [carrier.phone, carrier.email, carrier.website].filter(Boolean).join(' • ');
    if (infoLine1) doc.text(infoLine1, textX, 16, { maxWidth: 180 });
    if (infoLine2) doc.text(infoLine2, textX, 19, { maxWidth: 180 });
    doc.setTextColor(0);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
    doc.text('Manifesto de Carga', doc.internal.pageSize.getWidth() / 2, 12, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    const label =
      reportType === 'destination_summary' ? 'Resumo por Destino' :
      reportType === 'origin_summary' ? 'Resumo por Origem' : 'Lista de NF Importadas';
    doc.text(label, doc.internal.pageSize.getWidth() / 2, 17, { align: 'center' });

    doc.setFontSize(7);
    doc.text(`Gerado em: ${generatedAt.toLocaleString('pt-BR')}`, doc.internal.pageSize.getWidth() - 14, 12, { align: 'right' });
  };

  let startY = 24;

  if (manifest && (manifest.manifestNumber || manifest.vehiclePlate || manifest.driverName)) {
    drawHeader();
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    const manifestRows: RowInput[] = [
      [
        { content: `Nº Manifesto: ${manifest.manifestNumber || '—'}`, styles: { fontStyle: 'bold' } },
        `Marca: ${manifest.vehicleBrand || '—'}`,
        `Placa: ${manifest.vehiclePlate || '—'}`,
        `Cidade/UF: ${[manifest.vehicleCity, manifest.vehicleState].filter(Boolean).join('/') || '—'}`,
      ],
      [
        `Proprietário: ${manifest.vehicleOwner || '—'}`,
        { content: `Endereço: ${manifest.vehicleAddress || '—'}`, colSpan: 2 },
        `Motorista: ${manifest.driverName || '—'}`,
      ],
      [
        `Origem: ${manifest.origin || '—'}`,
        { content: `Destino: ${manifest.destination || '—'}`, colSpan: 3 },
      ],
    ];
    autoTable(doc, {
      startY,
      theme: 'plain',
      body: manifestRows,
      styles: { fontSize: 8, cellPadding: 1.2 },
      margin: { left: 14, right: 14 },
    });
    startY = getAutoTableFinalY(doc, startY) + 4;
  }

  const totals = getImportedNoteSummaryTotals(rows);

  const buildTable = (dataRows: RowInput[], startingY: number) => {
    autoTable(doc, {
      startY: startingY,
      head: [TABLE_HEAD],
      body: dataRows,
      styles: { fontSize: 7, cellPadding: 1.1, overflow: 'linebreak' },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 7 },
      columnStyles: {
        6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' },
        9: { halign: 'right' }, 10: { halign: 'right' },
      },
      margin: { left: 14, right: 14, top: 24 },
      didDrawPage: () => drawHeader(),
      showHead: 'everyPage',
    });
  };

  if (reportType === 'raw_list') {
    buildTable(rows.map(rowToTuple), startY);
  } else {
    const groups = groupNotesBy(rows, reportType === 'destination_summary' ? 'destination' : 'origin');
    let currentY = startY;
    let first = true;
    for (const g of groups) {
      const label = reportType === 'destination_summary' ? 'Destino' : 'Origem';
      const sub: RowInput[] = [
        [{
          content: `${label}: ${g.key} — ${g.items.length} nota(s)`,
          colSpan: TABLE_HEAD.length,
          styles: { fontStyle: 'bold', fillColor: [230, 230, 230] },
        }],
      ];
      const body: RowInput[] = [
        ...sub,
        ...g.items.map(rowToTuple),
        [
          { content: 'Subtotal', colSpan: 6, styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
          { content: brl(g.totals.totalValue), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
          { content: num3(g.totals.totalVolume), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
          { content: num3(g.totals.totalWeight), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
          { content: brl(g.totals.totalCif), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
          { content: brl(g.totals.totalFob), styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
          '',
        ],
      ];
      autoTable(doc, {
        startY: first ? currentY : undefined,
        head: first ? [TABLE_HEAD] : undefined,
        body,
        styles: { fontSize: 7, cellPadding: 1.1, overflow: 'linebreak' },
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 7 },
        columnStyles: {
          6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' },
          9: { halign: 'right' }, 10: { halign: 'right' },
        },
        margin: { left: 14, right: 14, top: 24 },
        didDrawPage: () => drawHeader(),
        showHead: 'firstPage',
      });
      currentY = getAutoTableFinalY(doc, currentY) + 2;
      first = false;
    }
  }

  // Total geral
  const finalY = getAutoTableFinalY(doc, startY);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  const totalLine = `TOTAL GERAL — Notas: ${totals.rowCount}   Valor: R$ ${brl(totals.totalValue)}   Volume: ${num3(totals.totalVolume)}   Peso: ${num3(totals.totalWeight)} kg   CIF: R$ ${brl(totals.totalCif)}   FOB: R$ ${brl(totals.totalFob)}`;
  doc.text(totalLine, 14, finalY + 6);

  // Rodapé "Página X de Y"
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text(`Página ${i} de ${pageCount}`, doc.internal.pageSize.getWidth() - 14, doc.internal.pageSize.getHeight() - 6, { align: 'right' });
  }

  return doc;
}

export function downloadImportedNotesSummaryPdf(opts: ReportOptions, fileName?: string) {
  const doc = generateImportedNotesSummaryPdf(opts);
  const name = fileName || `manifesto_${opts.reportType}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(name);
}
