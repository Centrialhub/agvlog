/**
 * Closing Report Builder — pure business logic for previews and totals.
 * Consumes existing load/fiscal/CT-e data and produces snapshot items.
 */

export type ReportType = 'weekly' | 'ten_day' | 'fortnightly' | 'monthly' | 'custom';
export type ReportModel = 'summary' | 'detailed' | 'combined';
export type FreightAllocation = 'per_nf' | 'cte_by_value' | 'cte_by_weight' | 'first_nf_only';

export interface RawFiscalDoc {
  id: string;
  invoice_number?: string | null;
  access_key?: string | null;
  issue_date?: string | null;
  origin_city?: string | null;
  origin_state?: string | null;
  remitter?: string | null;
  remitter_cnpj?: string | null;
  recipient?: string | null;
  recipient_cnpj?: string | null;
  recipient_city?: string | null;
  recipient_state?: string | null;
  value?: number | null;
  weight_kg?: number | null;
  volume_count?: number | null;
  freight_value?: number | null;
  freight_cif_value?: number | null;
  freight_fob_value?: number | null;
  load_id?: string | null;
  client_id?: string | null;
  imported_note_status?: string | null;
  delivery_meta?: { delivered_at?: string | null } | null;
}

export interface RawCte {
  id: string;
  cte_number?: string | null;
  access_key?: string | null;
  freight_value: number;
  weight_kg: number;
  fiscal_document_ids?: string[] | null;
  issued_at?: string | null;
}

export interface RawLoad {
  id: string;
  load_number?: string | null;
  external_load_number?: string | null;
  arrival_date?: string | null;
  load_date?: string | null;
  gate_departure_at?: string | null;
  arrival_at?: string | null;
  vehicle_id?: string | null;
  driver_id?: string | null;
  vehicle?: { plate?: string | null } | null;
  driver?: { name?: string | null } | null;
}

export interface BuilderInput {
  fiscalDocs: RawFiscalDoc[];
  ctes: RawCte[];
  loads: RawLoad[];
  freightAllocation?: FreightAllocation;
}

export interface BuiltItem {
  fiscal_document_id: string | null;
  cte_document_id: string | null;
  load_id: string | null;
  origin_city: string | null;
  origin_state: string | null;
  remitter_name: string | null;
  remitter_cnpj: string | null;
  recipient_name: string | null;
  recipient_cnpj: string | null;
  destination_city: string | null;
  destination_state: string | null;
  issue_date: string | null;
  arrival_date: string | null;
  delivery_date: string | null;
  invoice_number: string | null;
  invoice_key: string | null;
  cte_number: string | null;
  cte_key: string | null;
  load_number: string | null;
  invoice_value: number;
  weight_kg: number;
  volume_count: number;
  freight_value: number;
  freight_cif_value: number;
  freight_fob_value: number;
  delivery_status: string | null;
  observation: string | null;
  source_type: 'system' | 'xml_import' | 'spreadsheet_import' | 'manual_adjustment';
  sort_order: number;
  vehicle_id?: string | null;
  vehicle_plate?: string | null;
  driver_id?: string | null;
  driver_name?: string | null;
  departure_at?: string | null;
  arrival_at_ts?: string | null;
  days_count?: number | null;
  km_initial?: number | null;
  km_final?: number | null;
  km_driven?: number | null;
  fuel_liters?: number | null;
  fuel_unit_price?: number | null;
  fuel_total?: number | null;
  consumption_km_l?: number | null;
  route_label?: string | null;
  route_complement?: string | null;
}

export interface Divergence {
  severity: 'info' | 'warning' | 'error';
  code: string;
  description: string;
  fiscal_document_id?: string | null;
  cte_document_id?: string | null;
  load_id?: string | null;
  invoice_number?: string | null;
}

export interface SummaryLine {
  group_type: 'arrival_date' | 'billing_period' | 'destination_city' | 'load' | 'remitter' | 'cte';
  group_label: string;
  total_invoice_value: number;
  total_freight_value: number;
  total_weight_kg: number;
  total_volume: number;
  fiscal_document_count: number;
}

export interface BuiltPreview {
  items: BuiltItem[];
  totals: {
    total_invoice_value: number;
    total_freight_value: number;
    total_weight_kg: number;
    total_volume: number;
    fiscal_document_count: number;
    cte_count: number;
    load_count: number;
  };
  divergences: Divergence[];
  summaryByArrival: SummaryLine[];
  summaryByDestination: SummaryLine[];
}

const num = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

export function buildPreview(input: BuilderInput): BuiltPreview {
  const alloc: FreightAllocation = input.freightAllocation ?? 'per_nf';
  const loadById = new Map(input.loads.map(l => [l.id, l]));
  const cteByFiscal = new Map<string, RawCte>();
  for (const c of input.ctes) {
    for (const fid of (c.fiscal_document_ids ?? [])) cteByFiscal.set(fid, c);
  }

  const allocatedFreight = new Map<string, number>();
  for (const c of input.ctes) {
    const fids = c.fiscal_document_ids ?? [];
    if (fids.length === 0) continue;
    if (fids.length === 1) { allocatedFreight.set(fids[0], num(c.freight_value)); continue; }
    if (alloc === 'first_nf_only') {
      allocatedFreight.set(fids[0], num(c.freight_value));
    } else if (alloc === 'cte_by_weight') {
      const docs = fids.map(id => input.fiscalDocs.find(d => d.id === id)).filter(Boolean) as RawFiscalDoc[];
      const totalW = docs.reduce((s, d) => s + num(d.weight_kg), 0);
      if (totalW > 0) {
        docs.forEach(d => allocatedFreight.set(d.id, num(c.freight_value) * (num(d.weight_kg) / totalW)));
      } else {
        allocatedFreight.set(fids[0], num(c.freight_value));
      }
    } else {
      const docs = fids.map(id => input.fiscalDocs.find(d => d.id === id)).filter(Boolean) as RawFiscalDoc[];
      const anyPerNf = alloc === 'per_nf' && docs.some(d => num(d.freight_value) > 0);
      if (anyPerNf) {
        docs.forEach(d => allocatedFreight.set(d.id, num(d.freight_value)));
      } else {
        const totalV = docs.reduce((s, d) => s + num(d.value), 0);
        if (totalV > 0) {
          docs.forEach(d => allocatedFreight.set(d.id, num(c.freight_value) * (num(d.value) / totalV)));
        } else {
          allocatedFreight.set(fids[0], num(c.freight_value));
        }
      }
    }
  }

  const seenKeys = new Set<string>();
  const items: BuiltItem[] = [];
  const divergences: Divergence[] = [];

  let order = 0;
  for (const d of input.fiscalDocs) {
    const key = d.access_key || `${d.invoice_number}|${d.remitter_cnpj}|${d.recipient_cnpj}|${d.issue_date}`;
    if (seenKeys.has(key)) {
      divergences.push({ severity: 'warning', code: 'duplicate_document', description: 'NF duplicada ignorada', fiscal_document_id: d.id, invoice_number: d.invoice_number ?? null });
      continue;
    }
    seenKeys.add(key);

    const cte = cteByFiscal.get(d.id);
    const load = d.load_id ? loadById.get(d.load_id) : undefined;
    const arrival = load?.arrival_date ?? null;
    const deliveryDate = d.delivery_meta?.delivered_at ?? null;
    const freight = allocatedFreight.has(d.id) ? allocatedFreight.get(d.id)! : num(d.freight_value);

    const departureAt = load?.gate_departure_at ?? null;
    const arrivalAtTs = load?.arrival_at ?? null;
    let daysCount: number | null = null;
    if (departureAt && arrivalAtTs) {
      const dep = new Date(departureAt).getTime();
      const arr = new Date(arrivalAtTs).getTime();
      if (Number.isFinite(dep) && Number.isFinite(arr) && arr >= dep) {
        daysCount = Math.max(0, Math.ceil((arr - dep) / 86400000));
      }
    }

    if (!cte) divergences.push({ severity: 'info', code: 'nf_without_cte', description: 'NF sem CT-e vinculado', fiscal_document_id: d.id, invoice_number: d.invoice_number ?? null });
    if (!num(d.weight_kg)) divergences.push({ severity: 'warning', code: 'nf_without_weight', description: 'NF sem peso', fiscal_document_id: d.id });
    if (!num(d.value)) divergences.push({ severity: 'warning', code: 'nf_without_value', description: 'NF sem valor', fiscal_document_id: d.id });
    if (!deliveryDate) divergences.push({ severity: 'info', code: 'nf_without_delivery', description: 'NF sem data de entrega', fiscal_document_id: d.id });
    if (freight === 0) divergences.push({ severity: 'warning', code: 'zero_freight', description: 'Frete zerado', fiscal_document_id: d.id });
    if (deliveryDate && d.issue_date && deliveryDate < d.issue_date) {
      divergences.push({ severity: 'error', code: 'delivery_before_issue', description: 'Data de entrega anterior à emissão', fiscal_document_id: d.id });
    }
    if (load && !arrival) divergences.push({ severity: 'info', code: 'load_without_arrival', description: 'Carga sem data de chegada', fiscal_document_id: d.id, load_id: load.id });

    items.push({
      fiscal_document_id: d.id,
      cte_document_id: cte?.id ?? null,
      load_id: d.load_id ?? null,
      origin_city: d.origin_city ?? null,
      origin_state: d.origin_state ?? null,
      remitter_name: d.remitter ?? null,
      remitter_cnpj: d.remitter_cnpj ?? null,
      recipient_name: d.recipient ?? null,
      recipient_cnpj: d.recipient_cnpj ?? null,
      destination_city: d.recipient_city ?? null,
      destination_state: d.recipient_state ?? null,
      issue_date: d.issue_date ?? null,
      arrival_date: arrival,
      delivery_date: deliveryDate,
      invoice_number: d.invoice_number ?? null,
      invoice_key: d.access_key ?? null,
      cte_number: cte?.cte_number ?? null,
      cte_key: cte?.access_key ?? null,
      load_number: load?.load_number ?? load?.external_load_number ?? null,
      invoice_value: num(d.value),
      weight_kg: num(d.weight_kg),
      volume_count: num(d.volume_count),
      freight_value: freight,
      freight_cif_value: num(d.freight_cif_value),
      freight_fob_value: num(d.freight_fob_value),
      delivery_status: d.imported_note_status ?? null,
      observation: null,
      source_type: 'system',
      sort_order: order++,
      vehicle_id: load?.vehicle_id ?? null,
      vehicle_plate: load?.vehicle?.plate ?? null,
      driver_id: load?.driver_id ?? null,
      driver_name: load?.driver?.name ?? null,
      departure_at: departureAt,
      arrival_at_ts: arrivalAtTs,
      days_count: daysCount,
      route_label: d.recipient_city ?? null,
      route_complement: d.origin_city ?? null,
    });
  }

  const totals = items.reduce(
    (acc, it) => {
      acc.total_invoice_value += it.invoice_value;
      acc.total_freight_value += it.freight_value;
      acc.total_weight_kg += it.weight_kg;
      acc.total_volume += it.volume_count;
      return acc;
    },
    { total_invoice_value: 0, total_freight_value: 0, total_weight_kg: 0, total_volume: 0, fiscal_document_count: items.length, cte_count: 0, load_count: 0 },
  );
  totals.cte_count = new Set(items.map(i => i.cte_document_id).filter(Boolean)).size;
  totals.load_count = new Set(items.map(i => i.load_id).filter(Boolean)).size;

  return {
    items,
    totals,
    divergences,
    summaryByArrival: groupSummary(items, 'arrival_date'),
    summaryByDestination: groupSummary(items, 'destination_city'),
  };
}

export function groupSummary(items: BuiltItem[], groupBy: SummaryLine['group_type']): SummaryLine[] {
  const map = new Map<string, SummaryLine>();
  for (const it of items) {
    const label =
      groupBy === 'arrival_date' ? (it.arrival_date ?? 'Sem data') :
      groupBy === 'destination_city' ? (it.destination_city ?? 'Sem destino') :
      groupBy === 'load' ? (it.load_number ?? 'Sem carga') :
      groupBy === 'remitter' ? (it.remitter_name ?? 'Sem remetente') :
      groupBy === 'cte' ? (it.cte_number ?? 'Sem CT-e') :
      (it.arrival_date ?? '—');
    let row = map.get(label);
    if (!row) {
      row = { group_type: groupBy, group_label: label, total_invoice_value: 0, total_freight_value: 0, total_weight_kg: 0, total_volume: 0, fiscal_document_count: 0 };
      map.set(label, row);
    }
    row.total_invoice_value += it.invoice_value;
    row.total_freight_value += it.freight_value;
    row.total_weight_kg += it.weight_kg;
    row.total_volume += it.volume_count;
    row.fiscal_document_count += 1;
  }
  return Array.from(map.values()).sort((a, b) => a.group_label.localeCompare(b.group_label));
}

export function computeClosingPaymentStatus(params: {
  totalAmount: number;
  receivedAmount: number;
  expectedPaymentDate?: string | null;
  cancelled?: boolean;
  today?: string;
}): 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled' {
  if (params.cancelled) return 'cancelled';
  const total = num(params.totalAmount);
  const rec = num(params.receivedAmount);
  const today = params.today ?? new Date().toISOString().slice(0, 10);
  if (rec <= 0) {
    if (params.expectedPaymentDate && params.expectedPaymentDate < today) return 'overdue';
    return 'unpaid';
  }
  if (rec >= total) return 'paid';
  return 'partially_paid';
}

export function periodFromType(type: ReportType, base: Date = new Date()): { period_start: string; period_end: string } {
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  if (type === 'weekly') {
    const day = base.getUTCDay();
    const monday = new Date(Date.UTC(y, m, d - ((day + 6) % 7)));
    const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
    return { period_start: iso(monday), period_end: iso(sunday) };
  }
  if (type === 'ten_day') {
    if (d <= 10) return { period_start: iso(new Date(Date.UTC(y, m, 1))), period_end: iso(new Date(Date.UTC(y, m, 10))) };
    if (d <= 20) return { period_start: iso(new Date(Date.UTC(y, m, 11))), period_end: iso(new Date(Date.UTC(y, m, 20))) };
    return { period_start: iso(new Date(Date.UTC(y, m, 21))), period_end: iso(new Date(Date.UTC(y, m + 1, 0))) };
  }
  if (type === 'fortnightly') {
    if (d <= 15) return { period_start: iso(new Date(Date.UTC(y, m, 1))), period_end: iso(new Date(Date.UTC(y, m, 15))) };
    return { period_start: iso(new Date(Date.UTC(y, m, 16))), period_end: iso(new Date(Date.UTC(y, m + 1, 0))) };
  }
  if (type === 'monthly') {
    return { period_start: iso(new Date(Date.UTC(y, m, 1))), period_end: iso(new Date(Date.UTC(y, m + 1, 0))) };
  }
  return { period_start: iso(base), period_end: iso(base) };
}

export function excelSerialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}
