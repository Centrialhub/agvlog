import { ParsedNFe } from '@/lib/documentParsers';
import { ParsedOrderRow } from '@/lib/documentParsers';
import { FiscalDocument } from '@/hooks/useFiscalDocuments';
import { Client } from '@/hooks/useClients';

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

// Validate a parsed NF-e against existing data
export function validateNFe(
  nfe: ParsedNFe,
  fileName: string,
  existingDocs: FiscalDocument[],
  clients: Client[],
): ValidatedDocument {
  const validations: ValidationResult[] = [];

  // Check duplicate by access key
  const isDuplicate = existingDocs.some(
    d => d.access_key && d.access_key === nfe.accessKey
  );
  if (isDuplicate) {
    validations.push({
      field: 'accessKey',
      message: `NF-e ${nfe.invoiceNumber} já importada (chave de acesso duplicada)`,
      severity: 'error',
    });
  }

  // Check duplicate by invoice number
  const duplicateByNumber = existingDocs.some(
    d => d.invoice_number === nfe.invoiceNumber && !isDuplicate
  );
  if (duplicateByNumber) {
    validations.push({
      field: 'invoiceNumber',
      message: `Nota fiscal nº ${nfe.invoiceNumber} já existe no sistema`,
      severity: 'warning',
    });
  }

  // Validate required fields
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

  // Match client by CNPJ
  let matchedClientId: string | null = null;
  let matchedClientName: string | null = null;
  const recipientDoc = (nfe.recipientCnpj || '').replace(/\D/g, '');
  if (recipientDoc) {
    const matched = clients.find(c => (c.tax_id || '').replace(/\D/g, '') === recipientDoc);
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

  // Validate destination
  if (!nfe.recipientCity && !nfe.recipientState) {
    validations.push({ field: 'destination', message: 'Endereço de destino incompleto', severity: 'warning' });
  }

  // Check item quantities
  nfe.items.forEach((item, idx) => {
    if (item.quantity <= 0) {
      validations.push({
        field: 'itemQuantity',
        message: `Item "${item.description}" com quantidade inválida`,
        severity: 'error',
        index: idx,
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

function findRouteForCity(city: string, routes: OperationalRouteRef[]): OperationalRouteRef | null {
  const normalized = normalizeCity(city);
  for (const route of routes) {
    for (const dest of route.destinations) {
      if (normalizeCity(dest.name) === normalized) {
        return route;
      }
    }
  }
  // Partial match fallback
  for (const route of routes) {
    for (const dest of route.destinations) {
      const nd = normalizeCity(dest.name);
      if (normalized.includes(nd) || nd.includes(normalized)) {
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
  const validDocs = documents.filter(d => !d.hasErrors && !d.isDuplicate);
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
