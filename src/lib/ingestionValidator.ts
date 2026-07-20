import { ParsedNFe } from '@/lib/documentParsers';
import { ParsedOrderRow } from '@/lib/documentParsers';
import { FiscalDocument } from '@/hooks/useFiscalDocuments';
import { Client } from '@/hooks/useClients';
import { normalizeFiscalNumber, normalizeTaxId } from '@/lib/fiscalDocuments/fiscalIdentity';

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationResult {
  field: string;
  message: string;
  severity: ValidationSeverity;
  index?: number; // row/item index
}

export interface ValidatedDocument {
  source: ParsedNFe;
  fileName: string;
  validations: ValidationResult[];
  hasErrors: boolean;
  hasWarnings: boolean;
  matchedClientId: string | null;
  matchedClientName: string | null;
  isDuplicate: boolean;
  /**
   * A NF já existe no banco mas está órfã (sem load_id vinculado). Pode ser
   * reaproveitada em uma nova carga — não conta como erro na importação.
   */
  isOrphanReusable?: boolean;
  /** ID do documento fiscal já existente (quando duplicado ou órfão). */
  existingDocumentId?: string | null;
}

export interface ValidatedOrder {
  source: ParsedOrderRow;
  rowIndex: number;
  validations: ValidationResult[];
  hasErrors: boolean;
  hasWarnings: boolean;
  matchedClientId: string | null;
  matchedClientName: string | null;
}

// Pre-built indexes to avoid O(N*M) lookups when validating many docs
export interface ValidationIndexes {
  accessKeySet: Set<string>;
  invoiceNumberSet: Set<string>;
  clientByTaxId: Map<string, Client>;
  clientByNameLower: Map<string, Client>;
  /** existing doc por chave de acesso — usado para detectar órfãos reutilizáveis */
  docByAccessKey: Map<string, FiscalDocument>;
  /** existing doc por número de nota (fallback quando falta a chave) */
  docByInvoiceNumber: Map<string, FiscalDocument>;
  /** existing doc por identidade fiscal composta: fornecedor + modelo + série + número */
  docByCompositeIdentity: Map<string, FiscalDocument>;
}

function fiscalCompositeKey(input: {
  emitterCnpj?: string | null;
  remitterCnpj?: string | null;
  model?: string | null;
  fiscal_model?: string | null;
  series?: string | null;
  invoice_series?: string | null;
  invoiceNumber?: string | null;
  invoice_number?: string | null;
}): string | null {
  const cnpj = normalizeTaxId(input.emitterCnpj || input.remitterCnpj);
  const number = normalizeFiscalNumber(input.invoiceNumber || input.invoice_number);
  if (!cnpj || !number) return null;
  const model = normalizeFiscalNumber(input.model || input.fiscal_model) || '55';
  const series = normalizeFiscalNumber(input.series || input.invoice_series) || '0';
  return [cnpj, model, series, number].join(':');
}

export function buildValidationIndexes(existingDocs: FiscalDocument[], clients: Client[]): ValidationIndexes {
  const accessKeySet = new Set<string>();
  const invoiceNumberSet = new Set<string>();
  const docByAccessKey = new Map<string, FiscalDocument>();
  const docByInvoiceNumber = new Map<string, FiscalDocument>();
  const docByCompositeIdentity = new Map<string, FiscalDocument>();
  for (const d of existingDocs) {
    if (d.access_key) {
      accessKeySet.add(d.access_key);
      docByAccessKey.set(d.access_key, d);
    }
    const compositeKey = fiscalCompositeKey(d);
    if (compositeKey && !docByCompositeIdentity.has(compositeKey)) {
      docByCompositeIdentity.set(compositeKey, d);
    }
    if (d.invoice_number) {
      invoiceNumberSet.add(d.invoice_number);
      if (!docByInvoiceNumber.has(d.invoice_number)) docByInvoiceNumber.set(d.invoice_number, d);
    }
  }
  const clientByTaxId = new Map<string, Client>();
  const clientByNameLower = new Map<string, Client>();
  for (const c of clients) {
    const tax = (c.tax_id || '').replace(/\D/g, '');
    if (tax) clientByTaxId.set(tax, c);
    if (c.company_name) clientByNameLower.set(c.company_name.toLowerCase(), c);
  }
  return { accessKeySet, invoiceNumberSet, clientByTaxId, clientByNameLower, docByAccessKey, docByInvoiceNumber, docByCompositeIdentity };
}

// Validate a parsed NF-e against existing data
export function validateNFe(
  nfe: ParsedNFe,
  fileName: string,
  existingDocs: FiscalDocument[],
  clients: Client[],
  indexes?: ValidationIndexes,
): ValidatedDocument {
  const idx = indexes || buildValidationIndexes(existingDocs, clients);
  const validations: ValidationResult[] = [];

  const hasDuplicateAccessKey = !!nfe.accessKey && idx.accessKeySet.has(nfe.accessKey);
  const existingByKey = nfe.accessKey ? idx.docByAccessKey.get(nfe.accessKey) : undefined;
  const nfeCompositeKey = fiscalCompositeKey(nfe);
  const existingByComposite = !existingByKey && nfeCompositeKey ? idx.docByCompositeIdentity.get(nfeCompositeKey) : undefined;
  const existingByNumber = !existingByKey && !existingByComposite && nfe.invoiceNumber ? idx.docByInvoiceNumber.get(nfe.invoiceNumber) : undefined;
  const existing = existingByKey || existingByComposite || existingByNumber;
  const existingDocumentId = existing?.id || null;
  // Órfão reutilizável: NF já existe no banco mas ainda não foi vinculada a
  // uma carga (load_id === null) e não foi cancelada. Nesse caso não é erro:
  // é uma retomada de importação parcial anterior.
  const isOrphanReusable = !!existing && !existing.load_id && existing.status !== 'cancelled';

  if (hasDuplicateAccessKey) {
    validations.push({
      field: 'accessKey',
      message: isOrphanReusable
        ? `NF-e ${nfe.invoiceNumber} já salva anteriormente sem carga — será reaproveitada nesta importação.`
        : `NF-e ${nfe.invoiceNumber} já importada e vinculada a uma carga (chave de acesso duplicada).`,
      severity: isOrphanReusable ? 'info' : 'error',
    });
  }

  const duplicateByComposite = !hasDuplicateAccessKey && !!existingByComposite;
  if (duplicateByComposite) {
    validations.push({
      field: 'fiscalIdentity',
      message: isOrphanReusable
        ? `Nota fiscal nº ${nfe.invoiceNumber} já existe para o mesmo fornecedor/série/modelo (sem carga) — será reaproveitada.`
        : `Nota fiscal nº ${nfe.invoiceNumber} já existe para o mesmo fornecedor/série/modelo e não pode ser importada novamente`,
      severity: isOrphanReusable ? 'info' : 'error',
    });
  }

  const duplicateByLegacyNumber = !hasDuplicateAccessKey && !duplicateByComposite && !!existingByNumber;
  if (duplicateByLegacyNumber) {
    validations.push({
      field: 'invoiceNumber',
      message: isOrphanReusable
        ? `Nota fiscal nº ${nfe.invoiceNumber} já existe sem carga — será reaproveitada.`
        : `Nota fiscal nº ${nfe.invoiceNumber} já existe, mas sem chave/identidade fiscal completa para confirmar duplicidade.`,
      severity: isOrphanReusable ? 'info' : 'warning',
    });
  }

  const isDuplicate = hasDuplicateAccessKey || duplicateByComposite || duplicateByLegacyNumber;

  if (!nfe.invoiceNumber) {
    validations.push({ field: 'invoiceNumber', message: 'Número da NF não encontrado', severity: 'error' });
  }
  if (!nfe.recipientName && !nfe.recipientCnpj) {
    validations.push({ field: 'recipient', message: 'Destinatário não identificado', severity: 'error' });
  }
  if (!nfe.issueDate) {
    validations.push({ field: 'issueDate', message: 'Data de emissão não encontrada', severity: 'warning' });
  }
  if (nfe.items.length === 0) {
    validations.push({ field: 'items', message: 'Nenhum item encontrado na NF-e', severity: 'warning' });
  }
  if (nfe.totalValue <= 0) {
    validations.push({ field: 'totalValue', message: 'Valor total zerado ou não encontrado', severity: 'warning' });
  }
  if (nfe.totalWeight <= 0) {
    validations.push({ field: 'totalWeight', message: 'Peso não informado — estimativa de paletes pode ser imprecisa', severity: 'info' });
  }

  // Auditoria de extração da carga do cliente — ajuda a identificar XMLs com formato fora das regras
  if (!nfe.clientLoadNumber) {
    const obsSnippet = (nfe.observation || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (obsSnippet) {
      validations.push({
        field: 'clientLoadNumber',
        message: `Número da carga do cliente não encontrado. Observação (trecho): "${obsSnippet}${nfe.observation.length > 200 ? '…' : ''}" — ajuste as regras em CLIENT_LOAD_OBSERVATION_RULES se necessário.`,
        severity: 'info',
      });
       
      console.warn('[ingestion] Carga do cliente NÃO extraída', {
        invoiceNumber: nfe.invoiceNumber,
        accessKey: nfe.accessKey,
        recipient: nfe.recipientName,
        observationSnippet: obsSnippet,
      });
    } else {
      validations.push({
        field: 'clientLoadNumber',
        message: 'Número da carga do cliente não encontrado (NF-e sem xPed e sem observação).',
        severity: 'info',
      });
    }
  } else if (nfe.clientLoadSource === 'observation' && nfe.clientLoadRuleLabel) {
    validations.push({
      field: 'clientLoadNumber',
      message: `Carga "${nfe.clientLoadNumber}" extraída da observação via regra "${nfe.clientLoadRuleLabel}".`,
      severity: 'info',
    });
  }

  let matchedClientId: string | null = null;
  let matchedClientName: string | null = null;
  const recipientDoc = (nfe.recipientCnpj || '').replace(/\D/g, '');
  if (recipientDoc) {
    const matched = idx.clientByTaxId.get(recipientDoc);
    if (matched) {
      matchedClientId = matched.id;
      matchedClientName = matched.company_name;
    } else {
      validations.push({
        field: 'client',
        message: `Cliente não cadastrado: ${nfe.recipientName} (${nfe.recipientCnpj})`,
        severity: 'warning',
      });
    }
  }

  if (!nfe.recipientCity && !nfe.recipientState) {
    validations.push({ field: 'destination', message: 'Endereço de destino incompleto', severity: 'warning' });
  }

  nfe.items.forEach((item, idx2) => {
    if (item.quantity <= 0) {
      validations.push({
        field: 'itemQuantity',
        message: `Item "${item.description}" com quantidade inválida`,
        severity: 'error',
        index: idx2,
      });
    }
  });

  const hasErrors = validations.some(v => v.severity === 'error');
  const hasWarnings = validations.some(v => v.severity === 'warning');

  return {
    source: nfe,
    fileName,
    validations,
    hasErrors,
    hasWarnings,
    matchedClientId,
    matchedClientName,
    isDuplicate,
    isOrphanReusable,
    existingDocumentId,
  };
}

// Validate CSV order rows
export function validateOrderRows(
  rows: ParsedOrderRow[],
  clients: Client[],
): ValidatedOrder[] {
  const seen = new Set<string>();

  return rows.map((row, idx) => {
    const validations: ValidationResult[] = [];

    // Duplicate order number
    if (row.orderNumber) {
      if (seen.has(row.orderNumber)) {
        validations.push({ field: 'orderNumber', message: `Pedido duplicado: ${row.orderNumber}`, severity: 'warning', index: idx });
      }
      seen.add(row.orderNumber);
    } else {
      validations.push({ field: 'orderNumber', message: 'Número do pedido vazio', severity: 'error', index: idx });
    }

    if (!row.clientName && !row.clientCnpj) {
      validations.push({ field: 'client', message: 'Cliente não identificado', severity: 'error', index: idx });
    }

    if (row.quantity <= 0 && row.palletCount <= 0) {
      validations.push({ field: 'quantity', message: 'Quantidade e paletes zerados', severity: 'warning', index: idx });
    }

    if (!row.destination) {
      validations.push({ field: 'destination', message: 'Destino não informado', severity: 'warning', index: idx });
    }

    // Match client
    let matchedClientId: string | null = null;
    let matchedClientName: string | null = null;
    const cnpjClean = (row.clientCnpj || '').replace(/\D/g, '');
    if (cnpjClean) {
      const matched = clients.find(c => (c.tax_id || '').replace(/\D/g, '') === cnpjClean);
      if (matched) {
        matchedClientId = matched.id;
        matchedClientName = matched.company_name;
      }
    } else if (row.clientName) {
      const matched = clients.find(c =>
        c.company_name.toLowerCase().includes(row.clientName.toLowerCase()) ||
        row.clientName.toLowerCase().includes(c.company_name.toLowerCase())
      );
      if (matched) {
        matchedClientId = matched.id;
        matchedClientName = matched.company_name;
      }
    }

    if (!matchedClientId && (row.clientName || row.clientCnpj)) {
      validations.push({ field: 'client', message: `Cliente não encontrado: ${row.clientName || row.clientCnpj}`, severity: 'warning', index: idx });
    }

    return {
      source: row,
      rowIndex: idx,
      validations,
      hasErrors: validations.some(v => v.severity === 'error'),
      hasWarnings: validations.some(v => v.severity === 'warning'),
      matchedClientId,
      matchedClientName,
    };
  });
}

// Group documents by destination region for load suggestions
export interface LoadSuggestion {
  region: string;
  routeId: string | null;
  routeName: string | null;
  documents: ValidatedDocument[];
  orders: ValidatedOrder[];
  totalPallets: number;
  totalWeight: number;
  totalValue: number;
  stopCount: number;
}

export interface OperationalRouteRef {
  id: string;
  name: string;
  destinations: { name: string }[];
}

function normalizeCity(city: string): string {
  return city
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9 ]/g, '')
    .trim();
}

const PREPOSITIONS = new Set(['DE', 'DO', 'DA', 'DOS', 'DAS', 'D', 'E', 'EM', 'NO', 'NA', 'NOS', 'NAS']);

/** Remove prepositions and split into significant words */
function cityWords(city: string): string[] {
  return normalizeCity(city).split(/\s+/).filter(w => w.length > 0 && !PREPOSITIONS.has(w));
}

/** Check if abbreviated word matches full word (e.g. "G" matches "GRANDE", "M" matches "MINAS") */
function wordMatches(a: string, b: string): boolean {
  if (a === b) return true;
  // One is abbreviation of the other (1-3 chars)
  if (a.length <= 3 && b.startsWith(a)) return true;
  if (b.length <= 3 && a.startsWith(b)) return true;
  return false;
}

/** Check if all words from the shorter array match words in the longer array (order-independent) */
function citiesMatch(wordsA: string[], wordsB: string[]): boolean {
  if (wordsA.length === 0 || wordsB.length === 0) return false;
  const shorter = wordsA.length <= wordsB.length ? wordsA : wordsB;
  const longer = wordsA.length <= wordsB.length ? wordsB : wordsA;
  
  // Every word in the shorter form must match some word in the longer form
  const used = new Set<number>();
  for (const sw of shorter) {
    let found = false;
    for (let i = 0; i < longer.length; i++) {
      if (!used.has(i) && wordMatches(sw, longer[i])) {
        used.add(i);
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

export function findRouteForCity(city: string, routes: OperationalRouteRef[]): OperationalRouteRef | null {
  const cw = cityWords(city);
  if (cw.length === 0) return null;
  
  // Exact normalized match first
  const normalized = normalizeCity(city);
  for (const route of routes) {
    for (const dest of route.destinations) {
      if (normalizeCity(dest.name) === normalized) {
        return route;
      }
    }
  }
  
  // Smart abbreviation-aware match
  for (const route of routes) {
    for (const dest of route.destinations) {
      const dw = cityWords(dest.name);
      if (citiesMatch(cw, dw)) {
        return route;
      }
    }
  }
  return null;
}

export function generateLoadSuggestions(
  documents: ValidatedDocument[],
  orders: ValidatedOrder[],
  routes: OperationalRouteRef[] = [],
): LoadSuggestion[] {
  const validDocs = documents.filter(d => !d.hasErrors && (!d.isDuplicate || d.isOrphanReusable));
  const validOrders = orders.filter(o => !o.hasErrors);

  const regionMap = new Map<string, LoadSuggestion>();

  const getOrCreateGroup = (key: string, routeId: string | null, routeName: string | null): LoadSuggestion => {
    if (!regionMap.has(key)) {
      regionMap.set(key, { region: key, routeId, routeName, documents: [], orders: [], totalPallets: 0, totalWeight: 0, totalValue: 0, stopCount: 0 });
    }
    return regionMap.get(key)!;
  };

  validDocs.forEach(doc => {
    const city = doc.source.recipientCity || '';
    const matchedRoute = city ? findRouteForCity(city, routes) : null;
    const key = matchedRoute ? matchedRoute.name : ([doc.source.recipientState, city].filter(Boolean).join(' - ') || 'Sem região');
    const group = getOrCreateGroup(key, matchedRoute?.id || null, matchedRoute?.name || null);
    group.documents.push(doc);
    group.totalPallets += doc.source.estimatedPallets;
    group.totalWeight += doc.source.totalWeight;
    group.totalValue += doc.source.totalValue;
    group.stopCount += 1;
  });

  validOrders.forEach(order => {
    const dest = order.source.destination || '';
    const matchedRoute = dest ? findRouteForCity(dest, routes) : null;
    const key = matchedRoute ? matchedRoute.name : (dest || 'Sem região');
    const group = getOrCreateGroup(key, matchedRoute?.id || null, matchedRoute?.name || null);
    group.orders.push(order);
    group.totalPallets += order.source.palletCount || Math.ceil(order.source.quantity / 50);
    group.totalWeight += order.source.weightKg;
    group.stopCount += 1;
  });

  return Array.from(regionMap.values()).sort((a, b) => b.totalPallets - a.totalPallets);
}
