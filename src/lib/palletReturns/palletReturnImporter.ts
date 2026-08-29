import * as XLSX from 'xlsx';

export interface ParsedPalletItem {
  code: string;
  name: string;
  color?: string | null;
  quantity: number;
}

export interface ParsedPalletReturn {
  supplier: string | null;
  companyOrigin: string | null;
  issueDate: string | null; // ISO yyyy-mm-dd
  items: ParsedPalletItem[];
  totalDeclared: number | null;
  totalCalculated: number;
  hasTotalDivergence: boolean;
  rawTitle: string | null;
  rawReceiverText: string | null;
}

function excelSerialToISO(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && isFinite(v)) {
    // Excel serial (1900 base)
    const utcMs = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(utcMs);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    // dd/mm/yyyy
    const m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (m) {
      const dd = m[1].padStart(2, '0');
      const mm = m[2].padStart(2, '0');
      let yy = m[3];
      if (yy.length === 2) yy = '20' + yy;
      return `${yy}-${mm}-${dd}`;
    }
    // yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  }
  return null;
}

function normalize(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function stripAccent(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Extrai fornecedor do título "DEVOLUÇÃO PALETES P/ ALIANÇA" */
export function detectSupplierFromTitle(title: string): string | null {
  const clean = normalize(title);
  const m = clean.match(/DEVOLU[ÇC][AÃ]O\s+PALETES\s*P?\/?\s*(.+)/i);
  if (m) return normalize(m[1]);
  return null;
}

export function detectCompanyOrigin(text: string): string | null {
  const clean = normalize(text);
  const m = clean.match(/DEVOLU[ÇC][AÃ]O\s+DA\s+(.+?)\s+P\/?\s+/i);
  if (m) return normalize(m[1]);
  return null;
}

export function parsePalletReturnSheet(buffer: ArrayBuffer | Uint8Array, _fileName?: string): ParsedPalletReturn {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

  let supplier: string | null = null;
  let companyOrigin: string | null = null;
  let issueDate: string | null = null;
  let rawTitle: string | null = null;
  let rawReceiverText: string | null = null;
  const items: ParsedPalletItem[] = [];
  let totalDeclared: number | null = null;
  let inTable = false;

  for (const row of rows) {
    const cells = (row || []).map((c) => normalize(c));
    const joined = cells.join(' | ');
    const upper = stripAccent(joined).toUpperCase();

    if (!supplier && upper.includes('DEVOLUCAO PALETES')) {
      rawTitle = joined;
      // Look at each cell to find the title with supplier
      for (const c of cells) {
        const s = detectSupplierFromTitle(c);
        if (s) { supplier = s; break; }
      }
    }
    if (!companyOrigin) {
      for (const c of cells) {
        const s = detectCompanyOrigin(c);
        if (s) { companyOrigin = s; break; }
      }
    }
    if (!issueDate) {
      for (const c of row || []) {
        if (typeof c === 'string' && /DATA[:\s]/i.test(c)) {
          const m = c.match(/DATA[:\s]+([\d/.-]+)/i);
          if (m) {
            issueDate = excelSerialToISO(m[1]);
          }
        }
      }
      // any numeric date cell close to "DATA"
      if (!issueDate) {
        for (let i = 0; i < (row || []).length; i++) {
          const c = row[i];
          if (typeof c === 'string' && /^DATA\b/i.test(c.trim())) {
            for (let j = i; j < row!.length; j++) {
              const d = excelSerialToISO(row[j]);
              if (d) { issueDate = d; break; }
            }
          }
        }
      }
    }

    if (upper.includes('TIPO') && upper.includes('QTD')) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (upper.includes('TOTAL')) {
        // total row
        for (const c of row || []) {
          const n = Number(c);
          if (!isNaN(n) && n > 0) { totalDeclared = n; break; }
        }
        inTable = false;
        continue;
      }
      // Find code/name + qty in row
      let name: string | null = null;
      let qty: number | null = null;
      for (const c of row || []) {
        if (name == null && typeof c === 'string' && c.trim().length > 0 && isNaN(Number(c))) {
          name = c.trim();
        } else if (qty == null && (typeof c === 'number' || (typeof c === 'string' && /^\d+([.,]\d+)?$/.test(c.trim())))) {
          qty = typeof c === 'number' ? c : Number(String(c).replace(',', '.'));
        }
      }
      if (name && qty && qty > 0) {
        const code = name.toUpperCase().replace(/\s+/g, '_');
        items.push({ code, name, quantity: Math.round(qty) });
      }
    }

    if (upper.includes('RECEBEMOS')) rawReceiverText = joined;
  }

  const totalCalculated = items.reduce((s, i) => s + i.quantity, 0);
  return {
    supplier,
    companyOrigin,
    issueDate,
    items,
    totalDeclared,
    totalCalculated,
    hasTotalDivergence: totalDeclared != null && totalDeclared !== totalCalculated,
    rawTitle,
    rawReceiverText,
  };
}

export function protocolDedupeKey(supplier: string, issueDate: string, items: ParsedPalletItem[]): string {
  const sig = [...items].map((i) => `${i.code}:${i.quantity}`).sort().join('|');
  return `${stripAccent(supplier).toUpperCase()}#${issueDate}#${sig}`;
}
