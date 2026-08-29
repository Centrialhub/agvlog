import * as XLSX from 'xlsx';
import {
  getImportedNoteSummaryTotals, NOTE_STATUS_LABELS,
  type ImportedNoteRow,
} from '@/hooks/useImportedNotesSummary';

const dt = (value: unknown) => (value
  ? new Date(String(value).length <= 10 ? `${String(value)}T00:00:00` : String(value)).toLocaleDateString('pt-BR')
  : '');
const n2 = (value: unknown) => (value == null ? 0 : Math.round(Number(value) * 100) / 100);
const n3 = (value: unknown) => (value == null ? 0 : Math.round(Number(value) * 1000) / 1000);
const sumFormula = (formula: string): XLSX.CellObject => ({ t: 'n', f: formula });

/** Tipo de documento emitido para a nota (MOC = NFS-e, demais = CT-e). */
export function docTypeOf(r: ImportedNoteRow): 'NFS-e' | 'CT-e' | 'PENDENTE' {
  if (r.nfse_number) return 'NFS-e';
  if (r.cte_number || r.cte_id) return 'CT-e';
  return 'PENDENTE';
}

export function docNumberOf(r: ImportedNoteRow): string {
  return r.nfse_number || r.cte_number || '';
}

/**
 * Planilha pronta para envio ao cliente: uma linha por NF com o número do
 * documento emitido (CT-e ou NFS-e), mais aba de pendências.
 */
export function buildImportedNotesWorkbook(rows: ImportedNoteRow[]) {
  const header = [
    'Nº Nota', 'Emissão', 'Remetente', 'Destinatário', 'Cidade Destino', 'UF',
    'Tipo Documento', 'Nº Documento', 'Nº CT-e', 'Nº NFS-e', 'Chave CT-e',
    'Valor NF (R$)', 'Frete (R$)', 'Peso (kg)', 'Volumes', 'Situação',
  ];

  const toRow = (r: ImportedNoteRow) => [
    r.invoice_number || '',
    dt(r.issue_date),
    r.remitter || '',
    r.recipient || '',
    r.recipient_city || '',
    r.recipient_state || '',
    docTypeOf(r),
    docNumberOf(r),
    r.cte_number || '',
    r.nfse_number || '',
    r.cte_access_key || '',
    n2(r.value),
    n2(r.freight_cif_value ?? r.freight_value),
    n3(r.weight_kg),
    n3(r.volume_count ?? r.pallet_count),
    NOTE_STATUS_LABELS[r.operational_status] ?? r.operational_status ?? '',
  ];

  const emitted = rows.filter(r => docTypeOf(r) !== 'PENDENTE');
  const pending = rows.filter(r => docTypeOf(r) === 'PENDENTE');
  const t = getImportedNoteSummaryTotals(rows);

  const wb = XLSX.utils.book_new();

  const main = XLSX.utils.aoa_to_sheet([header, ...rows.map(toRow)]);
  const totalRowIdx = rows.length + 2; // 1-based, após header + linhas
  XLSX.utils.sheet_add_aoa(main, [[
    'TOTAL', '', '', '', '', '', '', '', '', '', '',
    sumFormula(`SUM(L2:L${rows.length + 1})`),
    sumFormula(`SUM(M2:M${rows.length + 1})`),
    sumFormula(`SUM(N2:N${rows.length + 1})`),
    sumFormula(`SUM(O2:O${rows.length + 1})`),
    `${t.rowCount} notas`,
  ]], { origin: `A${totalRowIdx}` });
  main['!cols'] = [
    { wch: 10 }, { wch: 11 }, { wch: 24 }, { wch: 30 }, { wch: 20 }, { wch: 5 },
    { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 46 },
    { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 18 },
  ];
  main['!autofilter'] = { ref: `A1:P${rows.length + 1}` };
  XLSX.utils.book_append_sheet(wb, main, 'Notas x Documentos');

  const emittedSheet = XLSX.utils.aoa_to_sheet([header, ...emitted.map(toRow)]);
  emittedSheet['!cols'] = main['!cols'];
  XLSX.utils.book_append_sheet(wb, emittedSheet, 'Emitidas');

  const pendingSheet = XLSX.utils.aoa_to_sheet([header, ...pending.map(toRow)]);
  pendingSheet['!cols'] = main['!cols'];
  XLSX.utils.book_append_sheet(wb, pendingSheet, 'Pendentes');

  const resume = XLSX.utils.aoa_to_sheet([
    ['Resumo'],
    ['Total de notas', t.rowCount],
    ['Com CT-e emitido', emitted.filter(r => docTypeOf(r) === 'CT-e').length],
    ['Com NFS-e emitida', emitted.filter(r => docTypeOf(r) === 'NFS-e').length],
    ['Sem documento (pendentes)', pending.length],
    [],
    ['Valor total das notas (R$)', n2(t.totalValue)],
    ['Frete total (R$)', n2(t.totalCif)],
    ['Peso total (kg)', n3(t.totalWeight)],
    ['Volumes', n3(t.totalVolume)],
  ]);
  resume['!cols'] = [{ wch: 30 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, resume, 'Resumo');

  return wb;
}

export function downloadImportedNotesXlsx(rows: ImportedNoteRow[]) {
  const wb = buildImportedNotesWorkbook(rows);
  XLSX.writeFile(wb, `relacao_nf_documentos_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
