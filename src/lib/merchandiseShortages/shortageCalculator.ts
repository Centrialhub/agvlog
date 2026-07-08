// Merchandise shortage calculations and validators.

export type ShortageStatus =
  | 'draft' | 'pending_review' | 'investigating'
  | 'waiting_driver' | 'waiting_supplier' | 'waiting_client'
  | 'confirmed_shortage' | 'not_shortage'
  | 'supplier_fault' | 'driver_fault' | 'company_fault' | 'customer_fault'
  | 'charged' | 'reimbursed' | 'written_off'
  | 'closed' | 'cancelled';

export type ResponsibleParty = 'driver' | 'supplier' | 'customer' | 'company' | 'unknown' | 'not_applicable';

export type ShortageType =
  | 'not_found_in_vehicle' | 'supplier_fault' | 'damage_before_dispatch'
  | 'inverted_product' | 'divergent_check' | 'refused_by_customer'
  | 'driver_not_found' | 'compensated_surplus' | 'separation_error'
  | 'loading_error' | 'no_proof' | 'other';

export interface ShortageItemInput {
  product_code?: string | null;
  product_description: string;
  quantity_text?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unit_cost?: number | null;
  total_amount?: number | null;
  item_observation?: string | null;
}

export interface QuantityParseResult {
  quantity: number | null;
  unit: string | null;
  raw: string;
  parsedSafely: boolean;
}

const UNIT_TOKENS = ['UN', 'CX', 'FD', 'DP', 'BR', 'PC', 'PCT', 'KG', 'L', 'ML', 'G'];

export function parseQuantity(input: string | number | null | undefined): QuantityParseResult {
  if (input == null || input === '') return { quantity: null, unit: null, raw: '', parsedSafely: false };
  if (typeof input === 'number') return { quantity: input, unit: null, raw: String(input), parsedSafely: true };
  const raw = String(input).trim();
  const normalized = raw.replace(',', '.').toUpperCase();
  // "1 display com 10" -> 10
  const displayMatch = normalized.match(/DISPLAY\s+COM\s+(\d+(?:\.\d+)?)/);
  if (displayMatch) return { quantity: Number(displayMatch[1]), unit: 'DISPLAY', raw, parsedSafely: true };
  const cxWithMatch = normalized.match(/^\s*(\d+(?:\.\d+)?)\s*CX\s+COM\s+(\d+(?:\.\d+)?)/);
  if (cxWithMatch) return { quantity: Number(cxWithMatch[1]) * Number(cxWithMatch[2]), unit: 'CX', raw, parsedSafely: true };
  const m = normalized.match(/^\s*(\d+(?:\.\d+)?)\s*([A-Z]*)/);
  if (m) {
    const qty = Number(m[1]);
    const unitCandidate = m[2] || null;
    const unit = unitCandidate && UNIT_TOKENS.includes(unitCandidate) ? unitCandidate : (unitCandidate || null);
    return { quantity: qty, unit, raw, parsedSafely: true };
  }
  return { quantity: null, unit: null, raw, parsedSafely: false };
}

export function computeItemTotal(item: ShortageItemInput): number {
  const parsed = item.quantity ?? parseQuantity(item.quantity_text).quantity;
  const cost = item.unit_cost ?? 0;
  if (parsed != null && Number.isFinite(parsed) && Number.isFinite(cost)) {
    return round2(parsed * cost);
  }
  return round2(item.total_amount ?? 0);
}

export function computeCaseTotal(items: ShortageItemInput[]): number {
  return round2(items.reduce((acc, it) => acc + (it.total_amount ?? computeItemTotal(it)), 0));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ValidationError { field: string; message: string; }

export function validateCase(input: {
  occurrence_date?: string | null;
  invoice_number?: string | null;
  invoice_justification?: string | null;
  items: ShortageItemInput[];
}): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!input.occurrence_date) errors.push({ field: 'occurrence_date', message: 'Data obrigatória' });
  if (!input.invoice_number && !input.invoice_justification) {
    errors.push({ field: 'invoice_number', message: 'NF obrigatória ou justificativa exigida' });
  }
  if (!input.items || input.items.length === 0) {
    errors.push({ field: 'items', message: 'Pelo menos um item obrigatório' });
  }
  input.items?.forEach((it, i) => {
    if (!it.product_description || !it.product_description.trim()) {
      errors.push({ field: `items.${i}.product_description`, message: 'Descrição obrigatória' });
    }
    if (it.quantity == null && !it.quantity_text) {
      errors.push({ field: `items.${i}.quantity`, message: 'Quantidade obrigatória' });
    }
    if ((it.unit_cost ?? 0) < 0) {
      errors.push({ field: `items.${i}.unit_cost`, message: 'Custo unitário deve ser >= 0' });
    }
  });
  return errors;
}

export function validateFinalize(status: string | null | undefined, opts: {
  responsible_party_type?: string | null;
  responsible_driver_id?: string | null;
  responsible_supplier_id?: string | null;
  cancellation_reason?: string | null;
}): ValidationError[] {
  const errors: ValidationError[] = [];
  if (status === 'closed' && !opts.responsible_party_type) {
    errors.push({ field: 'responsible_party_type', message: 'Responsável final obrigatório para encerrar' });
  }
  if (opts.responsible_party_type === 'driver' && !opts.responsible_driver_id) {
    errors.push({ field: 'responsible_driver_id', message: 'Motorista responsável obrigatório' });
  }
  if (opts.responsible_party_type === 'supplier' && !opts.responsible_supplier_id) {
    errors.push({ field: 'responsible_supplier_id', message: 'Fornecedor responsável obrigatório' });
  }
  if (status === 'cancelled' && !opts.cancellation_reason) {
    errors.push({ field: 'cancellation_reason', message: 'Motivo de cancelamento obrigatório' });
  }
  return errors;
}

export function detectShortageType(observation: string | null | undefined): ShortageType | null {
  if (!observation) return null;
  const s = observation.toUpperCase();
  if (s.includes('NÃO LOCALIZADO') || s.includes('NAO LOCALIZADO')) return 'not_found_in_vehicle';
  if (s.includes('FALTA DO FORNECEDOR') || s.includes('FALTA DIRETO')) return 'supplier_fault';
  if (s.includes('AVARIA')) return 'damage_before_dispatch';
  if (s.includes('INVERTIDO')) return 'inverted_product';
  if (s.includes('DIVERGENTE')) return 'divergent_check';
  if (s.includes('RECUSOU') || s.includes('RECUSA')) return 'refused_by_customer';
  if (s.includes('SEPARAÇÃO') || s.includes('SEPARACAO')) return 'separation_error';
  if (s.includes('CARREGAMENTO')) return 'loading_error';
  return 'other';
}

export function inferResponsibleParty(shortageType: ShortageType | null): ResponsibleParty {
  if (shortageType === 'supplier_fault') return 'supplier';
  if (shortageType === 'refused_by_customer') return 'customer';
  return 'unknown';
}

export function formatBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n ?? 0);
}

export function monthLabel(month: number, year: number): string {
  const names = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
  return `${names[month - 1]}/${year}`;
}
