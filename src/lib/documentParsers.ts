// NF-e XML parser — extracts structured data from Brazilian electronic invoice XML
import * as XLSX from 'xlsx';

/**
 * Regras configuráveis para extração do "número da carga do cliente" a partir do
 * texto livre da observação (infCpl/infAdFisco) da NF-e.
 *
 * Cada regra tem:
 *  - id: identificador estável para auditoria/log
 *  - label: descrição amigável
 *  - pattern: regex (case-insensitive) com 1 grupo de captura = o número
 *
 * A ordem importa: a primeira regra que casar é usada. Coloque as mais específicas no topo.
 * Para adicionar/ajustar padrões, basta editar este array.
 */
export const CLIENT_LOAD_OBSERVATION_RULES: Array<{ id: string; label: string; pattern: RegExp }> = [
  // "Pedido de Carga: 12345" / "Ped. Carga 12345"
  { id: 'pedido_carga',  label: 'Pedido de Carga',     pattern: /(?:pedido|ped\.?)\s*(?:de\s*)?carga[:\s\-#nº°.]*([A-Za-z0-9][A-Za-z0-9\-\/]{0,30})/i },
  // "Nº Carga 12345" / "Carga: 12345" / "CARGA Nº 12345"
  { id: 'carga',         label: 'Carga (genérico)',    pattern: /(?:n[ºo°.]?\s*)?carga[:\s\-#nº°.]*([A-Za-z0-9][A-Za-z0-9\-\/]{0,30})/i },
  // "OC 12345" / "OC: 12345" / "Ordem de Coleta 12345"
  { id: 'oc',            label: 'Ordem de Coleta (OC)',pattern: /\b(?:oc|ordem\s+de\s+coleta)[:\s\-#nº°.]*([A-Za-z0-9][A-Za-z0-9\-\/]{0,30})/i },
  // "OS 12345" / "Ordem de Serviço 12345"
  { id: 'os',            label: 'Ordem de Serviço (OS)', pattern: /\b(?:os|ordem\s+de\s+servi[çc]o)[:\s\-#nº°.]*([A-Za-z0-9][A-Za-z0-9\-\/]{0,30})/i },
  // "Romaneio: 12345" / "Romaneio Nº 12345"
  { id: 'romaneio',      label: 'Romaneio',            pattern: /\bromaneio[:\s\-#nº°.]*([A-Za-z0-9][A-Za-z0-9\-\/]{0,30})/i },
  // "Manifesto: 12345"
  { id: 'manifesto',     label: 'Manifesto',           pattern: /\bmanifesto[:\s\-#nº°.]*([A-Za-z0-9][A-Za-z0-9\-\/]{0,30})/i },
  // "Lote 12345" / "Lote: 12345"
  { id: 'lote',          label: 'Lote',                pattern: /\blote[:\s\-#nº°.]*([A-Za-z0-9][A-Za-z0-9\-\/]{0,30})/i },
  // "Pedido 12345" (último — só se nada mais casar)
  { id: 'pedido',        label: 'Pedido (genérico)',   pattern: /\b(?:pedido|ped\.?)[:\s\-#nº°.]*([0-9][A-Za-z0-9\-\/]{0,30})/i },
];

export type ClientLoadExtraction = {
  value: string;
  source: 'xPed' | 'observation' | 'none';
  ruleId?: string;
  ruleLabel?: string;
};

/** Extrai número da carga a partir de um texto livre (infCpl/infAdFisco) usando as regras configuráveis. */
export function extractClientLoadFromObservation(observation: string): { value: string; ruleId?: string; ruleLabel?: string } {
  if (!observation) return { value: '' };
  for (const rule of CLIENT_LOAD_OBSERVATION_RULES) {
    const m = observation.match(rule.pattern);
    if (m && m[1]) {
      const cleaned = m[1].trim().replace(/[.,;:]+$/, '');
      if (cleaned) return { value: cleaned, ruleId: rule.id, ruleLabel: rule.label };
    }
  }
  return { value: '' };
}

export interface ParsedNFeItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  ncm: string;
  cfop: string;
}

export interface ParsedNFe {
  invoiceNumber: string;
  series: string;
  accessKey: string;
  issueDate: string;
  emitterName: string;
  emitterCnpj: string;
  recipientName: string;
  recipientCnpj: string;
  recipientCity: string;
  recipientState: string;
  recipientAddress: string;
  recipientNeighborhood: string;
  items: ParsedNFeItem[];
  totalValue: number;
  totalWeight: number;
  totalVolume: number;
  estimatedPallets: number;
  clientLoadNumber: string;
  observation: string;
}

function getTagText(parent: Element, tagName: string): string {
  const el = parent.getElementsByTagName(tagName)[0]
    || parent.getElementsByTagName(`nfe:${tagName}`)[0];
  return el?.textContent?.trim() || '';
}

export function parseNFeXml(xmlString: string): ParsedNFe {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('XML inválido: ' + parseError.textContent);

  const infNFe = doc.getElementsByTagName('infNFe')[0] || doc.getElementsByTagName('nfe:infNFe')[0];
  if (!infNFe) throw new Error('Estrutura de NF-e não encontrada no XML');

  const accessKey = (infNFe.getAttribute('Id') || '').replace(/^NFe/, '');
  const ide = infNFe.getElementsByTagName('ide')[0];
  const invoiceNumber = getTagText(ide || infNFe, 'nNF');
  const series = getTagText(ide || infNFe, 'serie');
  const issueDate = (getTagText(ide || infNFe, 'dhEmi') || getTagText(ide || infNFe, 'dEmi') || '').substring(0, 10);

  const emit = infNFe.getElementsByTagName('emit')[0];
  const emitterName = getTagText(emit || infNFe, 'xNome');
  const emitterCnpj = getTagText(emit || infNFe, 'CNPJ');

  const dest = infNFe.getElementsByTagName('dest')[0];
  const recipientName = getTagText(dest || infNFe, 'xNome');
  const recipientCnpj = getTagText(dest || infNFe, 'CNPJ') || getTagText(dest || infNFe, 'CPF');
  
  const enderDest = dest?.getElementsByTagName('enderDest')[0];
  const recipientCity = getTagText(enderDest || infNFe, 'xMun');
  const recipientState = getTagText(enderDest || infNFe, 'UF');
  const recipientNeighborhood = getTagText(enderDest || infNFe, 'xBairro');
  const recipientAddress = [
    getTagText(enderDest || infNFe, 'xLgr'),
    getTagText(enderDest || infNFe, 'nro'),
    recipientNeighborhood,
  ].filter(Boolean).join(', ');

  const detElements = infNFe.getElementsByTagName('det');
  const items: ParsedNFeItem[] = [];
  for (let i = 0; i < detElements.length; i++) {
    const prod = detElements[i].getElementsByTagName('prod')[0];
    if (!prod) continue;
    items.push({
      description: getTagText(prod, 'xProd'),
      quantity: parseFloat(getTagText(prod, 'qCom')) || 0,
      unit: getTagText(prod, 'uCom'),
      unitPrice: parseFloat(getTagText(prod, 'vUnCom')) || 0,
      totalPrice: parseFloat(getTagText(prod, 'vProd')) || 0,
      ncm: getTagText(prod, 'NCM'),
      cfop: getTagText(prod, 'CFOP'),
    });
  }

  // Extract client load number from BOTH sources, then pick the most specific (longest) one.
  // Source 1: <xPed> (structured purchase order field on each item)
  let xPedCandidate = '';
  for (let i = 0; i < detElements.length; i++) {
    const prod = detElements[i].getElementsByTagName('prod')[0];
    if (!prod) continue;
    const xPed = getTagText(prod, 'xPed');
    if (xPed) { xPedCandidate = xPed.trim(); break; }
  }

  // Source 2: <infCpl>/<infAdFisco> (free-text observation)
  const infAdic = infNFe.getElementsByTagName('infAdic')[0];
  const observation = getTagText(infAdic || infNFe, 'infCpl') || getTagText(infAdic || infNFe, 'infAdFisco') || '';
  let obsCandidate = '';
  if (observation) {
    const m = observation.match(/(?:n[ºo°.]?\s*)?carga[:\s-]*([A-Za-z0-9\-\/]+)/i)
      || observation.match(/(?:pedido|ped\.?)\s*(?:de\s*)?carga[:\s-]*([A-Za-z0-9\-\/]+)/i);
    if (m) obsCandidate = m[1].trim();
  }

  // Prefer the longer/more specific value; if equal length, observation wins (often the official client number)
  const clientLoadNumber = obsCandidate.length >= xPedCandidate.length ? obsCandidate : xPedCandidate;

  const total = infNFe.getElementsByTagName('ICMSTot')[0];
  const totalValue = parseFloat(getTagText(total || infNFe, 'vNF')) || 0;
  const transp = infNFe.getElementsByTagName('transp')[0];
  const volElements = transp?.getElementsByTagName('vol');
  let totalWeight = 0;
  let totalVolume = 0;

  if (volElements && volElements.length > 0) {
    for (let i = 0; i < volElements.length; i++) {
      const v = volElements[i];
      totalWeight += parseFloat(getTagText(v, 'pesoB')) || parseFloat(getTagText(v, 'pesoL')) || 0;
      totalVolume += parseFloat(getTagText(v, 'qVol')) || 0;
    }
  }

  const estimatedPallets = Math.max(1, Math.ceil(totalWeight / 800));

  return {
    invoiceNumber, series, accessKey, issueDate,
    emitterName, emitterCnpj, recipientName, recipientCnpj,
    recipientCity, recipientState, recipientAddress, recipientNeighborhood,
    items, totalValue, totalWeight, totalVolume, estimatedPallets,
    clientLoadNumber, observation,
  };
}

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

function parseRowsToOrders(headers: string[], dataRows: string[][]): ParsedOrderRow[] {
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
    .map((cols, i) => ({
      orderNumber: colOrder >= 0 ? cols[colOrder] || '' : `IMP-${i + 1}`,
      clientName: colClient >= 0 ? cols[colClient] || '' : '',
      clientCnpj: colCnpj >= 0 ? cols[colCnpj] || '' : '',
      destination: colDest >= 0 ? cols[colDest] || '' : '',
      items: colItems >= 0 ? cols[colItems] || '' : '',
      quantity: colQty >= 0 ? parseFloat(cols[colQty]) || 0 : 0,
      palletCount: colPallets >= 0 ? parseInt(cols[colPallets]) || 0 : 0,
      weightKg: colWeight >= 0 ? parseFloat(cols[colWeight]) || 0 : 0,
      promisedDate: colDate >= 0 ? cols[colDate] || '' : '',
    }));
}

export function parseCsvOrders(csvText: string): ParsedOrderRow[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(/[,;\t]/).map(h => h.trim().toLowerCase().replace(/["\s]/g, ''));
  const dataRows = lines.slice(1).map(l => l.split(/[,;\t]/).map(c => c.trim().replace(/^"|"$/g, '')));
  return parseRowsToOrders(headers, dataRows);
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
