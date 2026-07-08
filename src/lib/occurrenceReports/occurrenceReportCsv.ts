// UTF-8 with BOM CSV writer using ; as separator.

function fmtDate(v?: string | null): string {
  if (!v) return '';
  return v.slice(0, 10).split('-').reverse().join('/');
}

function fmtValue(n?: number | null): string {
  if (n == null) return '';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(cell: unknown): string {
  if (cell == null) return '';
  const s = String(cell);
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export interface CsvRow {
  [k: string]: unknown;
}

export function toCsvBlob(headers: string[], rows: CsvRow[], keys: string[]): Blob {
  const bom = '\uFEFF';
  const head = headers.map(esc).join(';');
  const body = rows.map((r) => keys.map((k) => esc(r[k])).join(';')).join('\n');
  return new Blob([bom + head + '\n' + body], { type: 'text/csv;charset=utf-8' });
}

export function returnedNotesCsv(rows: Array<{
  customer_name?: string | null;
  city?: string | null;
  occurrence_number?: string | null;
  invoice_number?: string | null;
  return_type?: string | null;
  invoice_value?: number | null;
  reason?: string | null;
  quantity_text?: string | null;
  product_description?: string | null;
  password_or_authorization?: string | null;
}>): Blob {
  return toCsvBlob(
    ['Cliente', 'Cidade', 'Nº Ocorrência', 'Nota Fiscal', 'Tipo', 'Valor NF', 'Motivo', 'QTD', 'Descrição', 'Senha'],
    rows.map((r) => ({
      ...r,
      invoice_value: fmtValue(r.invoice_value ?? 0),
    })),
    ['customer_name', 'city', 'occurrence_number', 'invoice_number', 'return_type', 'invoice_value', 'reason', 'quantity_text', 'product_description', 'password_or_authorization'],
  );
}

export function unservedNotesCsv(rows: Array<{
  invoice_number?: string | null;
  customer_name?: string | null;
  city?: string | null;
  invoice_issue_date?: string | null;
  invoice_value?: number | null;
  supplier_name?: string | null;
  notes?: string | null;
}>): Blob {
  return toCsvBlob(
    ['NF', 'Cliente', 'Cidade', 'Data da NF', 'Valor', 'Fornecedor', 'Observação'],
    rows.map((r) => ({
      ...r,
      invoice_issue_date: fmtDate(r.invoice_issue_date),
      invoice_value: fmtValue(r.invoice_value ?? 0),
    })),
    ['invoice_number', 'customer_name', 'city', 'invoice_issue_date', 'invoice_value', 'supplier_name', 'notes'],
  );
}
