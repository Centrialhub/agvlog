import * as XLSX from 'xlsx';

export interface ExcelBundleOptions {
  title: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  clientName?: string | null;
  supplierName?: string | null;
  rows: Record<string, unknown>[];
  headers: string[];
  keys: string[];
  pending?: Array<{ message: string; reference?: string }>;
  filters?: Record<string, unknown>;
}

export function buildOccurrenceReportExcel(opts: ExcelBundleOptions): Blob {
  const wb = XLSX.utils.book_new();

  const meta = [
    ['Título', opts.title],
    ['Período', `${opts.periodStart ?? ''} a ${opts.periodEnd ?? ''}`],
    ['Cliente', opts.clientName ?? ''],
    ['Fornecedor', opts.supplierName ?? ''],
    ['Gerado em', new Date().toLocaleString('pt-BR')],
  ];
  const wsMeta = XLSX.utils.aoa_to_sheet([['Metadado', 'Valor'], ...meta]);
  XLSX.utils.book_append_sheet(wb, wsMeta, 'Metadados');

  const resumo = [
    ['Total de linhas', opts.rows.length],
    ['Pendências', (opts.pending ?? []).length],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Indicador', 'Valor'], ...resumo]), 'Resumo');

  const detalhado = [opts.headers, ...opts.rows.map((r) => opts.keys.map((k) => r[k] ?? ''))];
  const wsDet = XLSX.utils.aoa_to_sheet(detalhado);
  wsDet['!freeze'] = { xSplit: 0, ySplit: 1 } as unknown as XLSX.WorkSheet['!freeze'];
  XLSX.utils.book_append_sheet(wb, wsDet, 'Detalhado');

  if (opts.pending && opts.pending.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['Referência', 'Mensagem'], ...opts.pending.map((p) => [p.reference ?? '', p.message])]),
      'Pendências',
    );
  }

  if (opts.filters) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['Filtro', 'Valor'], ...Object.entries(opts.filters).map(([k, v]) => [k, String(v ?? '')])]),
      'Filtros',
    );
  }

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
