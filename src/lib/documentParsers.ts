// NF-e XML parser — extracts structured data from Brazilian electronic invoice XML
import * as XLSX from 'xlsx';
import { detectPaymentMethodDetailed } from './paymentMethodDetection';
import { normalizeIbgeCity, normalizeCep, normalizeUf, normalizePhone, normalizeCpfCnpj } from './fiscalAddress';


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
  model: string;
  accessKey: string;
  issueDate: string;
  emitterName: string;
  emitterCnpj: string;
  emitterStateRegistration?: string;
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
  /** Camada que detectou a forma de pagamento (auditoria). */
  paymentMethodSource?: 'tpag' | 'xpag' | 'cobr' | 'infcpl_context' | 'infcpl_keyword' | 'indpag' | null;
  /** Número de parcelas (count de <dup>). */
  installmentCount?: number | null;
  /** Primeira data de vencimento (dVenc da 1ª <dup>), YYYY-MM-DD. */
  firstDueDate?: string | null;
  /** Período médio em dias entre emissão e vencimentos (média de dVenc - dhEmi). */
  averageDueDays?: number | null;
  /** Descrição amigável da forma de pagamento (ex.: "Boleto a prazo (3 parcelas)"). */
  paymentDescription?: string | null;
}

function getTagText(parent: Element, tagName: string): string {
  const el = parent.getElementsByTagName(tagName)[0]
    || parent.getElementsByTagName(`nfe:${tagName}`)[0];
  return el?.textContent?.trim() || '';
}

/** Mapa tPag (NF-e v4) -> valor interno usado no sistema. */
const TPAG_MAP: Record<string, string> = {
  '01': 'dinheiro',
  '02': 'cheque',
  '03': 'cartao_credito',
  '04': 'cartao_debito',
  '14': 'boleto',        // duplicata mercantil
  '15': 'boleto',
  '16': 'transferencia', // depósito bancário
  '17': 'pix',
  '18': 'transferencia',
};

/** Rótulos amigáveis para UI a partir do paymentMethod normalizado. */
const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro',
  cheque: 'Cheque',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  pix: 'PIX',
  transferencia: 'Transferência',
  boleto: 'Boleto',
  a_prazo: 'A prazo',
  a_vista: 'À vista',
  faturado: 'Faturado',
};

type RecipientFields = Pick<ParsedNFe,
  'recipientName' | 'recipientCnpj' | 'recipientFantasyName' | 'recipientStateRegistration'
  | 'recipientMunicipalRegistration' | 'recipientIeIndicator' | 'recipientPhone' | 'recipientEmail'
  | 'recipientCity' | 'recipientCityCode' | 'recipientState' | 'recipientAddress'
  | 'recipientAddressNumber' | 'recipientAddressComplement' | 'recipientNeighborhood'
  | 'recipientZip' | 'recipientCountry' | 'recipientCountryCode'>;

function extractRecipient(infNFe: Element): RecipientFields {
  const dest = infNFe.getElementsByTagName('dest')[0];
  const enderDest = dest?.getElementsByTagName('enderDest')[0];
  const ctx = dest || infNFe;
  const addr = enderDest || infNFe;
  return {
    recipientName: getTagText(ctx, 'xNome'),
    recipientCnpj: normalizeCpfCnpj(getTagText(ctx, 'CNPJ') || getTagText(ctx, 'CPF')),
    recipientFantasyName: getTagText(ctx, 'xFant'),
    recipientStateRegistration: getTagText(ctx, 'IE'),
    recipientMunicipalRegistration: getTagText(ctx, 'IM'),
    recipientIeIndicator: getTagText(ctx, 'indIEDest'),
    recipientEmail: getTagText(ctx, 'email'),
    recipientPhone: normalizePhone(getTagText(addr, 'fone') || getTagText(ctx, 'fone')) || '',
    recipientCity: getTagText(addr, 'xMun'),
    recipientCityCode: normalizeIbgeCity(getTagText(addr, 'cMun')),
    recipientState: normalizeUf(getTagText(addr, 'UF')) || getTagText(addr, 'UF'),
    recipientNeighborhood: getTagText(addr, 'xBairro'),
    recipientAddress: getTagText(addr, 'xLgr'),
    recipientAddressNumber: getTagText(addr, 'nro'),
    recipientAddressComplement: getTagText(addr, 'xCpl'),
    recipientZip: normalizeCep(getTagText(addr, 'CEP')) || getTagText(addr, 'CEP'),
    recipientCountry: getTagText(addr, 'xPais') || 'BRASIL',
    recipientCountryCode: getTagText(addr, 'cPais') || '1058',

  };
}

function extractItems(detElements: HTMLCollectionOf<Element>): ParsedNFeItem[] {
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
  return items;
}

function extractTransportTotals(infNFe: Element): { totalWeight: number; totalVolume: number } {
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
  return { totalWeight, totalVolume };
}

function extractClientLoad(
  detElements: HTMLCollectionOf<Element>,
  observation: string,
): { clientLoadNumber: string; clientLoadSource: 'xPed' | 'observation' | 'none'; clientLoadRuleId?: string; clientLoadRuleLabel?: string } {
  // Source 1: <xPed> (campo estruturado em cada item)
  let xPedCandidate = '';
  for (let i = 0; i < detElements.length; i++) {
    const prod = detElements[i].getElementsByTagName('prod')[0];
    if (!prod) continue;
    const xPed = getTagText(prod, 'xPed');
    if (xPed) { xPedCandidate = xPed.trim(); break; }
  }
  // Source 2: observação livre via regras configuráveis
  const obsExtraction = extractClientLoadFromObservation(observation);
  const obsCandidate = obsExtraction.value;
  // Prefere o mais específico (mais longo); empate vai para observação.
  if (obsCandidate && obsCandidate.length >= xPedCandidate.length) {
    return {
      clientLoadNumber: obsCandidate,
      clientLoadSource: 'observation',
      clientLoadRuleId: obsExtraction.ruleId,
      clientLoadRuleLabel: obsExtraction.ruleLabel,
    };
  }
  if (xPedCandidate) {
    return { clientLoadNumber: xPedCandidate, clientLoadSource: 'xPed' };
  }
  return { clientLoadNumber: '', clientLoadSource: 'none' };
}

type PaymentFields = Pick<ParsedNFe,
  'paymentMethod' | 'paymentMethodCode' | 'paymentMethodSource'
  | 'installmentCount' | 'firstDueDate' | 'averageDueDays' | 'paymentDescription'>;

function buildPaymentDescription(
  paymentMethod: string | null,
  installmentCount: number | null,
  averageDueDays: number | null,
): string | null {
  if (!paymentMethod) return null;
  let desc = PAYMENT_LABELS[paymentMethod] || paymentMethod;
  if (installmentCount && installmentCount >= 2) {
    desc = `${desc === 'Boleto' ? 'Boleto a prazo' : desc} (${installmentCount} parcelas)`;
  }
  if (averageDueDays && averageDueDays > 0 && !desc.includes('dias')) {
    desc += ` — ${averageDueDays} dias`;
  }
  return desc;
}

function extractPayment(infNFe: Element, ide: Element | undefined, observation: string, issueDate: string): PaymentFields {
  let paymentMethod: string | null = null;
  let paymentMethodCode: string | null = null;
  let paymentMethodSource: ParsedNFe['paymentMethodSource'] = null;

  // Camada 1: <pag>/<detPag>/<tPag>
  const pag = infNFe.getElementsByTagName('pag')[0];
  let xPagText = '';
  if (pag) {
    const detPagList = Array.from(pag.getElementsByTagName('detPag'));
    const candidates = detPagList.length ? detPagList : [pag];
    const xPagPieces: string[] = [];
    for (const detPag of candidates) {
      const tPag = getTagText(detPag, 'tPag');
      const xp = getTagText(detPag, 'xPag');
      if (xp) xPagPieces.push(xp);
      if (!tPag) continue;
      const mapped = TPAG_MAP[tPag] || null;
      if (!paymentMethodCode) paymentMethodCode = tPag;
      if (!paymentMethod && mapped && tPag !== '90' && tPag !== '99') {
        paymentMethod = mapped;
        paymentMethodCode = tPag;
        paymentMethodSource = 'tpag';
      }
    }
    xPagText = [...xPagPieces, getTagText(pag, 'xPag')].filter(Boolean).join(' | ');
  }
  // Camada 2: <xPag> — descrição livre (tPag=99)
  if (!paymentMethod && xPagText) {
    const r = detectPaymentMethodDetailed(xPagText);
    if (r.value) { paymentMethod = r.value; paymentMethodSource = 'xpag'; }
  }
  // Camada 3: <cobr>/<dup> — duplicatas (sempre extrai parcelas)
  const cobr = infNFe.getElementsByTagName('cobr')[0];
  const dups = cobr ? Array.from(cobr.getElementsByTagName('dup')) : [];
  let installmentCount: number | null = null;
  let firstDueDate: string | null = null;
  let averageDueDays: number | null = null;
  if (dups.length > 0) {
    installmentCount = dups.length;
    const dVencs = dups.map(d => getTagText(d, 'dVenc')).filter(Boolean);
    if (dVencs.length > 0) {
      firstDueDate = dVencs[0];
      const emiTs = issueDate ? Date.parse(issueDate) : NaN;
      if (!Number.isNaN(emiTs)) {
        const diffs = dVencs
          .map(d => (Date.parse(d) - emiTs) / 86_400_000)
          .filter(n => Number.isFinite(n) && n >= 0);
        if (diffs.length > 0) {
          averageDueDays = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
        }
      }
    }
    if (!paymentMethod) {
      paymentMethod = dups.length >= 2 ? 'a_prazo' : 'boleto';
      paymentMethodSource = 'cobr';
    }
  }
  // Camada 4: texto livre da observação
  if (!paymentMethod && observation) {
    const r = detectPaymentMethodDetailed(observation);
    if (r.value) {
      paymentMethod = r.value;
      paymentMethodSource = r.source === 'context' ? 'infcpl_context' : 'infcpl_keyword';
    }
  }
  // Camada 5: fallback genérico antigo (indPag)
  if (!paymentMethod) {
    const indPag = getTagText(ide || infNFe, 'indPag');
    if (indPag === '0') { paymentMethod = 'a_vista'; paymentMethodSource = 'indpag'; }
    else if (indPag === '1') { paymentMethod = 'a_prazo'; paymentMethodSource = 'indpag'; }
  }

  return {
    paymentMethod,
    paymentMethodCode,
    paymentMethodSource,
    installmentCount,
    firstDueDate,
    averageDueDays,
    paymentDescription: buildPaymentDescription(paymentMethod, installmentCount, averageDueDays),
  };
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
  const model = getTagText(ide || infNFe, 'mod') || '55';
  const issueDate = (getTagText(ide || infNFe, 'dhEmi') || getTagText(ide || infNFe, 'dEmi') || '').substring(0, 10);

  const emit = infNFe.getElementsByTagName('emit')[0];
  const emitterName = getTagText(emit || infNFe, 'xNome');
  const emitterCnpj = getTagText(emit || infNFe, 'CNPJ');
  const emitterStateRegistration = getTagText(emit || infNFe, 'IE');

  const recipient = extractRecipient(infNFe);
  const detElements = infNFe.getElementsByTagName('det');
  const items = extractItems(detElements);

  const infAdic = infNFe.getElementsByTagName('infAdic')[0];
  const observation = getTagText(infAdic || infNFe, 'infCpl') || getTagText(infAdic || infNFe, 'infAdFisco') || '';
  const clientLoad = extractClientLoad(detElements, observation);

  const total = infNFe.getElementsByTagName('ICMSTot')[0];
  const totalValue = parseFloat(getTagText(total || infNFe, 'vNF')) || 0;
  const { totalWeight, totalVolume } = extractTransportTotals(infNFe);
  const estimatedPallets = Math.max(1, Math.ceil(totalWeight / 800));

  const payment = extractPayment(infNFe, ide, observation, issueDate);

  return {
    invoiceNumber, series, model, accessKey, issueDate,
    emitterName, emitterCnpj, emitterStateRegistration,
    ...recipient,
    items, totalValue, totalWeight, totalVolume, estimatedPallets,
    observation,
    ...clientLoad,
    ...payment,
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
