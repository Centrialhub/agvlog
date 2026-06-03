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
  recipientFantasyName: string;
  recipientStateRegistration: string;
  recipientMunicipalRegistration: string;
  recipientIeIndicator: string; // '1' Contribuinte, '2' Isento, '9' Não contribuinte
  recipientPhone: string;
  recipientEmail: string;
  recipientCity: string;
  recipientCityCode: string;
  recipientState: string;
  recipientAddress: string;
  recipientAddressNumber: string;
  recipientAddressComplement: string;
  recipientNeighborhood: string;
  recipientZip: string;
  recipientCountry: string;
  recipientCountryCode: string;
  items: ParsedNFeItem[];
  totalValue: number;
  totalWeight: number;
  totalVolume: number;
  estimatedPallets: number;
  clientLoadNumber: string;
  observation: string;
  clientLoadSource?: 'xPed' | 'observation' | 'none';
  clientLoadRuleId?: string;
  clientLoadRuleLabel?: string;
  /** Forma de pagamento normalizada a partir de <pag>/<detPag>/<tPag> (ou indPag). */
  paymentMethod?: string | null;
  /** Código bruto tPag conforme NF-e (01..99) — para auditoria. */
  paymentMethodCode?: string | null;
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
  const recipientFantasyName = getTagText(dest || infNFe, 'xFant');
  const recipientStateRegistration = getTagText(dest || infNFe, 'IE');
  const recipientMunicipalRegistration = getTagText(dest || infNFe, 'IM');
  const recipientIeIndicator = getTagText(dest || infNFe, 'indIEDest');
  const recipientEmail = getTagText(dest || infNFe, 'email');

  const enderDest = dest?.getElementsByTagName('enderDest')[0];
  const recipientCity = getTagText(enderDest || infNFe, 'xMun');
  const recipientCityCode = getTagText(enderDest || infNFe, 'cMun');
  const recipientState = getTagText(enderDest || infNFe, 'UF');
  const recipientNeighborhood = getTagText(enderDest || infNFe, 'xBairro');
  const recipientAddress = getTagText(enderDest || infNFe, 'xLgr');
  const recipientAddressNumber = getTagText(enderDest || infNFe, 'nro');
  const recipientAddressComplement = getTagText(enderDest || infNFe, 'xCpl');
  const recipientZip = getTagText(enderDest || infNFe, 'CEP');
  const recipientCountry = getTagText(enderDest || infNFe, 'xPais') || 'BRASIL';
  const recipientCountryCode = getTagText(enderDest || infNFe, 'cPais') || '1058';
  const recipientPhone = getTagText(enderDest || infNFe, 'fone') || getTagText(dest || infNFe, 'fone');

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

  // Source 2: <infCpl>/<infAdFisco> (free-text observation) using configurable rules
  const infAdic = infNFe.getElementsByTagName('infAdic')[0];
  const observation = getTagText(infAdic || infNFe, 'infCpl') || getTagText(infAdic || infNFe, 'infAdFisco') || '';
  const obsExtraction = extractClientLoadFromObservation(observation);
  const obsCandidate = obsExtraction.value;

  // Prefer the longer/more specific value; tie goes to observation (usually the official client number)
  let clientLoadNumber = '';
  let clientLoadSource: 'xPed' | 'observation' | 'none' = 'none';
  let clientLoadRuleId: string | undefined;
  let clientLoadRuleLabel: string | undefined;
  if (obsCandidate && obsCandidate.length >= xPedCandidate.length) {
    clientLoadNumber = obsCandidate;
    clientLoadSource = 'observation';
    clientLoadRuleId = obsExtraction.ruleId;
    clientLoadRuleLabel = obsExtraction.ruleLabel;
  } else if (xPedCandidate) {
    clientLoadNumber = xPedCandidate;
    clientLoadSource = 'xPed';
  }

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

  // Forma de pagamento: padrão NF-e v4 <pag>/<detPag>/<tPag>
  // Mapeia código tPag -> valor interno usado no sistema.
  const TPAG_MAP: Record<string, string> = {
    '01': 'dinheiro',
    '02': 'cheque',
    '03': 'cartao_credito',
    '04': 'cartao_debito',
    '15': 'boleto',
    '16': 'transferencia', // depósito bancário
    '17': 'pix',
    '18': 'transferencia',
    '14': 'boleto',        // duplicata mercantil
  };
  let paymentMethod: string | null = null;
  let paymentMethodCode: string | null = null;
  const pag = infNFe.getElementsByTagName('pag')[0];
  if (pag) {
    const detPagList = pag.getElementsByTagName('detPag');
    const detPag = detPagList[0] || pag;
    const tPag = getTagText(detPag, 'tPag');
    if (tPag) {
      paymentMethodCode = tPag;
      paymentMethod = TPAG_MAP[tPag] || null;
    }
  }
  // Fallback antigo: indPag (0=à vista, 1=a prazo) no <ide>
  if (!paymentMethod) {
    const indPag = getTagText(ide || infNFe, 'indPag');
    if (indPag === '0') paymentMethod = 'a_vista';
    else if (indPag === '1') paymentMethod = 'a_prazo';
  }

  return {
    invoiceNumber, series, accessKey, issueDate,
    emitterName, emitterCnpj, recipientName, recipientCnpj,
    recipientFantasyName, recipientStateRegistration, recipientMunicipalRegistration,
    recipientIeIndicator, recipientPhone, recipientEmail,
    recipientCity, recipientCityCode, recipientState,
    recipientAddress, recipientAddressNumber, recipientAddressComplement,
    recipientNeighborhood, recipientZip, recipientCountry, recipientCountryCode,
    items, totalValue, totalWeight, totalVolume, estimatedPallets,
    clientLoadNumber, observation,
    clientLoadSource, clientLoadRuleId, clientLoadRuleLabel,
    paymentMethod, paymentMethodCode,
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
