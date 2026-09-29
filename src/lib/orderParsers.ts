import * as XLSX from 'xlsx';

// CSV/Excel parser for orders
export interface ParsedOrderRow {
  orderNumber: string;
  clientName: string;
  clientCnpj: string;
  destination: string;
  items: string;
  quantity: number;
  palletCount: number;
  weightKg: number;
  promisedDate: string;
}

function parseCsvOrderNumber(value: string, decimalConvention: 'comma' | 'dot'): number {
  const compact = value.trim();
  if (!compact) return 0;

  const comma = compact.lastIndexOf(',');
  const dot = compact.lastIndexOf('.');
  let normalized = compact;
  if (comma >= 0 && dot >= 0) {
    if (comma > dot && /^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/.test(compact)) {
      normalized = compact.replace(/\./g, '').replace(',', '.');
    } else if (dot > comma && /^[+-]?\d{1,3}(?:,\d{3})+\.\d+$/.test(compact)) {
      normalized = compact.replace(/,/g, '');
    } else {
      return Number.NaN;
    }
  } else if (comma >= 0) {
    normalized = compact.replace(',', '.');
  } else if (decimalConvention === 'comma' && /^[+-]?\d{1,3}(?:\.\d{3})+$/.test(compact)) {
    normalized = compact.replace(/\./g, '');
  }
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)
    ? Number(normalized)
    : Number.NaN;
}

function parseCsvOrderMeasure(
  value: string, label: string, record: number,
  decimalConvention: 'comma' | 'dot', integer = false,
): number {
  const parsed = parseCsvOrderNumber(value, decimalConvention);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('CSV inválido: ' + label + ' no registro ' + record + ' deve ser um número finito e não negativo');
  }
  if (integer && (!Number.isInteger(parsed) || parsed > 2147483647)) {
    throw new Error('CSV inválido: paletes no registro ' + record + ' devem ser inteiros entre 0 e 2147483647');
  }
  return parsed;
}

function normalizeCsvOrderHeader(value: string): string {
  return value.trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function csvOrderDelimiter(text: string): ',' | ';' | '\t' {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (char === '\n' || char === '\r')) {
      break;
    } else if (!quoted && (char === ',' || char === ';' || char === '\t')) {
      counts[char]++;
    }
  }
  return (Object.keys(counts) as Array<keyof typeof counts>)
    .reduce((best, candidate) => counts[candidate] > counts[best] ? candidate : best, ',');
}

function parseDelimitedOrders(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted) { quoted = false; afterQuote = true; }
      else if (!afterQuote && !cell.trim()) { cell = ''; quoted = true; }
      else throw new Error('CSV inválido: aspas dentro de um campo sem aspas');
    } else if (afterQuote && char !== delimiter && char !== '\n' && char !== '\r') {
      if (!/\s/.test(char)) throw new Error('CSV inválido: conteúdo após fechar aspas');
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim()); cell = ''; afterQuote = false;
    } else if ((char === '\n' || char === '\r') && !quoted) {
      row.push(cell.trim()); rows.push(row);
      row = []; cell = ''; afterQuote = false;
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV inválido: campo entre aspas não foi fechado');
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

function parseRowsToOrders(
  headers: string[], dataRows: string[][], csvDecimalConvention?: 'comma' | 'dot',
): ParsedOrderRow[] {
  const findCol = (candidates: string[]) => {
    for (const c of candidates) {
      const idx = headers.findIndex(h => h.includes(c));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const colOrder = findCol(['pedido', 'order', 'numero', 'numpedido']);
  const colClient = findCol(['cliente', 'client', 'razao', 'empresa', 'nome']);
  const colCnpj = findCol(['cnpj', 'cpf', 'documento', 'taxid']);
  const colDest = findCol(['destino', 'destination', 'cidade', 'endereco', 'city']);
  const colItems = findCol(['item', 'produto', 'product', 'descricao', 'mercadoria']);
  const colQty = findCol(['quantidade', 'qty', 'qtd', 'quantity']);
  const colPallets = findCol(['palet', 'pallet', 'paletes']);
  const colWeight = findCol(['peso', 'weight', 'kg']);
  const colDate = findCol(['data', 'date', 'prazo', 'entrega', 'promised']);

  return dataRows
    .filter(cols => cols.length >= 2 && cols.some(c => !!c))
    .map((cols, i) => {
      const measure = (column: number, label: string, integer = false): number => {
        if (column < 0) return 0;
        const value = cols[column] || '';
        if (!csvDecimalConvention) return integer ? parseInt(value) || 0 : parseFloat(value) || 0;
        return parseCsvOrderMeasure(value, label, i + 2, csvDecimalConvention, integer);
      };
      return {
        orderNumber: colOrder >= 0 ? cols[colOrder] || '' : 'IMP-' + (i + 1),
        clientName: colClient >= 0 ? cols[colClient] || '' : '',
        clientCnpj: colCnpj >= 0 ? cols[colCnpj] || '' : '',
        destination: colDest >= 0 ? cols[colDest] || '' : '',
        items: colItems >= 0 ? cols[colItems] || '' : '',
        quantity: measure(colQty, 'quantidade'),
        palletCount: measure(colPallets, 'paletes', true),
        weightKg: measure(colWeight, 'peso'),
        promisedDate: colDate >= 0 ? cols[colDate] || '' : '',
      };
    });
}

export function parseCsvOrders(csvText: string): ParsedOrderRow[] {
  const delimiter = csvOrderDelimiter(csvText);
  const rows = parseDelimitedOrders(csvText.replace(/^\uFEFF/, ''), delimiter)
    .filter(row => row.some(cell => cell !== ''));
  if (rows.length === 0) return [];
  if (rows[0].length < 2) throw new Error('CSV inválido: cabeçalho sem delimitador reconhecido');
  if (rows.length < 2) return [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length !== rows[0].length) {
      throw new Error('CSV inválido: registro ' + (i + 1) + ' tem ' + rows[i].length
        + ' colunas; o cabeçalho tem ' + rows[0].length);
    }
  }
  const headers = rows[0].map(normalizeCsvOrderHeader);
  return parseRowsToOrders(headers, rows.slice(1), delimiter === ';' ? 'comma' : 'dot');
}

export function parseExcelOrders(buffer: ArrayBuffer): ParsedOrderRow[] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const jsonData = XLSX.utils.sheet_to_json<string[]>(firstSheet, { header: 1, defval: '' });
  if (jsonData.length < 2) return [];
  const headers = (jsonData[0] as string[]).map(h => String(h).trim().toLowerCase().replace(/["\s]/g, ''));
  const dataRows = jsonData.slice(1).map(row => (row as string[]).map(c => String(c).trim()));
  return parseRowsToOrders(headers, dataRows);
}
