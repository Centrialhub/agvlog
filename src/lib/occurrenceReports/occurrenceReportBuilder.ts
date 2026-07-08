// Domain helpers for the occurrence reports module.

export type ResolutionType =
  | 'delivered'
  | 'returned_total'
  | 'returned_partial'
  | 'partial_return'
  | 'shortage_found'
  | 'surplus_found'
  | 'collection_requested'
  | 'collection_done'
  | 'rejected_invoice'
  | 'no_purchase_order'
  | 'order_divergence'
  | 'inverted_product'
  | 'damaged_before_dispatch'
  | 'refused_by_customer'
  | 'no_dispatch_week'
  | 'rescheduled'
  | 'pending_client'
  | 'pending_supplier'
  | 'cancelled';

export type OccurrenceStatus =
  | 'open'
  | 'in_review'
  | 'waiting_client'
  | 'waiting_supplier'
  | 'waiting_driver'
  | 'resolved'
  | 'closed'
  | 'cancelled';

export type ReportType =
  | 'returned_notes'
  | 'unserved_notes_week'
  | 'shortage_surplus'
  | 'collection'
  | 'custom';

export interface DeliveryOccurrenceRow {
  id?: string;
  tenant_id?: string;
  invoice_number?: string | null;
  cte_number?: string | null;
  occurrence_number?: string | null;
  customer_name?: string | null;
  supplier_name?: string | null;
  city?: string | null;
  state?: string | null;
  occurrence_type?: string | null;
  occurrence_reason?: string | null;
  occurrence_description?: string | null;
  occurrence_date?: string | null;
  resolution_type?: ResolutionType | string | null;
  resolution_notes?: string | null;
  resolved_at?: string | null;
  status?: OccurrenceStatus | string | null;
  password_or_authorization?: string | null;
  invoice_value?: number | null;
  quantity_text?: string | null;
  product_description?: string | null;
}

export interface FinalizePayload {
  resolution_type?: string | null;
  resolution_notes?: string | null;
  reason?: string | null;
  resolved_at?: string | Date | null;
  responsible_user_id?: string | null;
  password_or_authorization?: string | null;
  items?: Array<{ product_description?: string | null; quantity_text?: string | null }>;
}

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validates a payload used to finalize an occurrence.
 * Guarantees: resolution_type is mandatory; partial-like returns need at least an item.
 */
export function validateFinalize(payload: FinalizePayload): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!payload.resolution_type) {
    errors.push({ field: 'resolution_type', message: 'Resolução é obrigatória' });
  }
  if (!payload.resolution_notes && !payload.reason) {
    errors.push({ field: 'resolution_notes', message: 'Motivo ou observação da resolução é obrigatório' });
  }
  const partialTypes = new Set(['returned_partial', 'partial_return', 'shortage_found']);
  if (payload.resolution_type && partialTypes.has(payload.resolution_type)) {
    const hasItem = (payload.items ?? []).some(
      (it) => (it.product_description && it.product_description.trim()) || (it.quantity_text && it.quantity_text.trim()),
    );
    if (!hasItem) {
      errors.push({ field: 'items', message: 'Devolução parcial/falta exige ao menos um item ou descrição' });
    }
  }
  return errors;
}

/** Split "578812/578813/578814" or "a;b" into distinct invoice numbers. */
export function splitInvoiceNumbers(raw: string | number | null | undefined): string[] {
  if (raw == null) return [];
  return String(raw)
    .split(/[\/;,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Excel serial date -> ISO yyyy-mm-dd. Accepts Date, ISO string, or serial number. */
export function toIsoDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && isFinite(value)) {
    // Excel serial (1900 date system, ignoring the fictitious Feb 29 1900)
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // dd/MM/yyyy
    const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const d = m[1].padStart(2, '0');
      const mo = m[2].padStart(2, '0');
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${y}-${mo}-${d}`;
    }
    const asDate = new Date(trimmed);
    if (!isNaN(asDate.getTime())) return asDate.toISOString().slice(0, 10);
  }
  return null;
}

/** Parse Brazilian currency strings like "R$1,251,71" or "1.610,67" into a number. */
export function parseBrCurrency(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const cleaned = String(v)
    .replace(/[R$\s]/gi, '')
    .replace(/[^0-9,.-]/g, '');
  // If both . and , present, assume . thousands / , decimal.
  if (cleaned.includes(',') && cleaned.includes('.')) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  }
  if (cleaned.includes(',')) {
    // Could be "1,251,71" (bad thousands) — treat last comma as decimal separator.
    const parts = cleaned.split(',');
    const last = parts.pop() as string;
    return Number(parts.join('') + '.' + last) || 0;
  }
  return Number(cleaned) || 0;
}

export interface UnservedCandidate {
  invoice_number: string;
  status?: string | null;
  dispatched_at?: string | null;
  delivered_at?: string | null;
  cancelled?: boolean;
  returned_total?: boolean;
  arrived_at?: string | null;
}

/** Filter that returns true when an invoice qualifies as "sem saída na semana". */
export function isUnservedInWeek(
  candidate: UnservedCandidate,
  weekStart: string,
  weekEnd: string,
  options: { includeReturned?: boolean } = {},
): boolean {
  if (!candidate.invoice_number) return false;
  if (candidate.cancelled) return false;
  if (candidate.delivered_at) return false;
  if (!options.includeReturned && candidate.returned_total) return false;
  const dispatched = candidate.dispatched_at;
  if (dispatched && dispatched >= weekStart && dispatched <= weekEnd) return false;
  const status = (candidate.status ?? '').toLowerCase();
  if (status === 'entregue' || status === 'delivered') return false;
  return true;
}

export interface Aggregation {
  totalOccurrences: number;
  returnedTotal: number;
  returnedPartial: number;
  unservedWeek: number;
  shortages: number;
  surpluses: number;
  collectionsPending: number;
  collectionsDone: number;
  totalInvoiceValue: number;
  clients: number;
  suppliers: number;
}

export function aggregateOccurrences(rows: DeliveryOccurrenceRow[]): Aggregation {
  const clientSet = new Set<string>();
  const supplierSet = new Set<string>();
  let returnedTotal = 0;
  let returnedPartial = 0;
  let unservedWeek = 0;
  let shortages = 0;
  let surpluses = 0;
  let collectionsPending = 0;
  let collectionsDone = 0;
  let totalInvoiceValue = 0;
  for (const r of rows) {
    if (r.customer_name) clientSet.add(r.customer_name.trim().toUpperCase());
    if (r.supplier_name) supplierSet.add(r.supplier_name.trim().toUpperCase());
    totalInvoiceValue += Number(r.invoice_value || 0);
    switch (r.resolution_type) {
      case 'returned_total':
        returnedTotal += 1; break;
      case 'returned_partial':
      case 'partial_return':
        returnedPartial += 1; break;
      case 'shortage_found':
        shortages += 1; break;
      case 'surplus_found':
        surpluses += 1; break;
      case 'collection_requested':
        collectionsPending += 1; break;
      case 'collection_done':
        collectionsDone += 1; break;
      case 'no_dispatch_week':
        unservedWeek += 1; break;
    }
  }
  return {
    totalOccurrences: rows.length,
    returnedTotal,
    returnedPartial,
    unservedWeek,
    shortages,
    surpluses,
    collectionsPending,
    collectionsDone,
    totalInvoiceValue,
    clients: clientSet.size,
    suppliers: supplierSet.size,
  };
}

export const resolutionTypeLabels: Record<string, string> = {
  delivered: 'Entregue',
  returned_total: 'Devolução total',
  returned_partial: 'Devolução parcial',
  partial_return: 'Retorno parcial',
  shortage_found: 'Falta encontrada',
  surplus_found: 'Sobra encontrada',
  collection_requested: 'Coleta solicitada',
  collection_done: 'Coleta realizada',
  rejected_invoice: 'NF rejeitada',
  no_purchase_order: 'Sem pedido de compra',
  order_divergence: 'Divergência no pedido',
  inverted_product: 'Produto invertido',
  damaged_before_dispatch: 'Avaria antes da expedição',
  refused_by_customer: 'Cliente recusou',
  no_dispatch_week: 'Sem saída na semana',
  rescheduled: 'Reagendada',
  pending_client: 'Pendente cliente',
  pending_supplier: 'Pendente fornecedor',
  cancelled: 'Cancelada',
};

export const reportTypeLabels: Record<ReportType, string> = {
  returned_notes: 'Notas Devolvidas',
  unserved_notes_week: 'Notas Sem Saída na Semana',
  shortage_surplus: 'Faltas e Sobras',
  collection: 'Coletas',
  custom: 'Ocorrências Finalizadas',
};
