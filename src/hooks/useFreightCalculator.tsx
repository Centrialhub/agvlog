import { supabase } from '@/integrations/supabase/client';
import type { Json, Tables, TablesInsert } from '@/integrations/supabase/types';
import { localDateInputValue } from '@/lib/utils/formatDate';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';

type FreightTable = Tables<'freight_tables'>;

export interface FreightInput {
  tenantId: string;
  clientId?: string | null;
  payerName?: string | null;
  payerGroup?: string | null;
  destination?: string | null;
  destinationState?: string | null;
  destinationMunicipality?: string | null;
  origin?: string | null;
  originState?: string | null;
  originMunicipality?: string | null;
  route?: string | null;
  distributionType?: string | null;
  cargoType?: string | null;
  vehicleType?: string | null;
  bodyType?: string | null;
  ctrcType?: string | null;
  totalValue: number;
  totalWeight: number;
  totalPallets: number;
  referenceDate?: string | null;
}

export interface FreightBreakdown {
  tableName: string;
  tableId: string;
  tableCode: number;
  regionId?: string | null;
  regionName?: string | null;
  matchedCriteria: Record<string, string>;
  ignoredCriteria: string[];
  specificityScore: number;
  components: {
    ratePercent: number;
    rateValue: number;
    fixedValue: number;
    perKgValue: number;
    perKgTotal: number;
    perPalletValue: number;
    perPalletTotal: number;
    dispatchValue: number;
    trackingValue: number;
    tollValue: number;
    loadingValue: number;
    grisValue: number;
    insurancePercent: number;
    insuranceValue: number;
  };
  baseValue: number;
  minValue: number;
  finalValue: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  missingFields?: string[];
  unknownSubstitutions?: Record<string, string>;
}

export interface FreightResult {
  success: boolean;
  value: number;
  breakdown: FreightBreakdown | null;
  error?: string;
}

export function freightMetricValidationError(input: Pick<FreightInput, 'totalValue' | 'totalWeight' | 'totalPallets'>): string | null {
  const metrics = [
    ['valor da nota', input.totalValue],
    ['peso', input.totalWeight],
    ['quantidade de paletes', input.totalPallets],
  ] as const;
  const invalid = metrics.find(([, value]) => !Number.isFinite(value) || value < 0);
  return invalid ? `O ${invalid[0]} deve ser um número maior ou igual a zero` : null;
}

export function freightBreakdownToJson(breakdown: FreightBreakdown): Json {
  return {
    tableName: breakdown.tableName,
    tableId: breakdown.tableId,
    tableCode: breakdown.tableCode,
    regionId: breakdown.regionId ?? null,
    regionName: breakdown.regionName ?? null,
    matchedCriteria: breakdown.matchedCriteria,
    ignoredCriteria: breakdown.ignoredCriteria,
    specificityScore: breakdown.specificityScore,
    components: breakdown.components,
    baseValue: breakdown.baseValue,
    minValue: breakdown.minValue,
    finalValue: breakdown.finalValue,
    fallbackUsed: breakdown.fallbackUsed,
    fallbackReason: breakdown.fallbackReason ?? null,
    missingFields: breakdown.missingFields ?? [],
    unknownSubstitutions: breakdown.unknownSubstitutions ?? {},
  };
}

function jsonObject(value: Json | null | undefined): { [key: string]: Json | undefined } | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function jsonNumber(value: Json | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function freightBreakdownFromJson(value: Json | null | undefined): FreightBreakdown | null {
  const source = jsonObject(value);
  const componentSource = jsonObject(source?.components);
  if (!source || !componentSource || typeof source.tableName !== 'string' ||
      typeof source.tableId !== 'string' || typeof source.tableCode !== 'number') return null;

  const matchedSource = jsonObject(source.matchedCriteria);
  const matchedCriteria = Object.fromEntries(
    Object.entries(matchedSource ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  const ignoredCriteria = Array.isArray(source.ignoredCriteria)
    ? source.ignoredCriteria.filter((item): item is string => typeof item === 'string')
    : [];
  const missingFields = Array.isArray(source.missingFields)
    ? source.missingFields.filter((item): item is string => typeof item === 'string')
    : undefined;
  const substitutionsSource = jsonObject(source.unknownSubstitutions);
  const unknownSubstitutions = substitutionsSource
    ? Object.fromEntries(
        Object.entries(substitutionsSource).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    : undefined;

  return {
    tableName: source.tableName,
    tableId: source.tableId,
    tableCode: source.tableCode,
    regionId: typeof source.regionId === 'string' ? source.regionId : null,
    regionName: typeof source.regionName === 'string' ? source.regionName : null,
    matchedCriteria,
    ignoredCriteria,
    specificityScore: jsonNumber(source.specificityScore),
    components: {
      ratePercent: jsonNumber(componentSource.ratePercent),
      rateValue: jsonNumber(componentSource.rateValue),
      fixedValue: jsonNumber(componentSource.fixedValue),
      perKgValue: jsonNumber(componentSource.perKgValue),
      perKgTotal: jsonNumber(componentSource.perKgTotal),
      perPalletValue: jsonNumber(componentSource.perPalletValue),
      perPalletTotal: jsonNumber(componentSource.perPalletTotal),
      dispatchValue: jsonNumber(componentSource.dispatchValue),
      trackingValue: jsonNumber(componentSource.trackingValue),
      tollValue: jsonNumber(componentSource.tollValue),
      loadingValue: jsonNumber(componentSource.loadingValue),
      grisValue: jsonNumber(componentSource.grisValue),
      insurancePercent: jsonNumber(componentSource.insurancePercent),
      insuranceValue: jsonNumber(componentSource.insuranceValue),
    },
    baseValue: jsonNumber(source.baseValue),
    minValue: jsonNumber(source.minValue),
    finalValue: jsonNumber(source.finalValue),
    fallbackUsed: source.fallbackUsed === true,
    fallbackReason: typeof source.fallbackReason === 'string' ? source.fallbackReason : undefined,
    missingFields,
    unknownSubstitutions,
  };
}

export function computeSpecificity(table: Partial<FreightTable>, input: FreightInput): { score: number; eligible: boolean; matched: Record<string, string>; ignored: string[] } {
  let score = 0;
  let eligible = true;
  const matched: Record<string, string> = {};
  const ignored: string[] = [];

  const check = (field: string, tableVal: string | null | undefined, inputVal: string | null | undefined) => {
    if (!tableVal) return; // wildcard
    if (inputVal && tableVal.toLowerCase() === inputVal.toLowerCase()) {
      score += 10;
      matched[field] = tableVal;
    } else {
      eligible = false;
      score -= 100; // mismatch = disqualify
      ignored.push(`${field}: table="${tableVal}" vs input="${inputVal || '(vazio)'}"`);
    }
  };

  const checkContains = (field: string, tableVal: string | null | undefined, inputVal: string | null | undefined) => {
    if (!tableVal) return;
    if (inputVal && inputVal.toLowerCase().includes(tableVal.toLowerCase())) {
      score += 5;
      matched[field] = tableVal;
    } else {
      eligible = false;
      score -= 100;
      ignored.push(`${field}: table="${tableVal}" vs input="${inputVal || '(vazio)'}"`);
    }
  };

  check('client_id', table.client_id, input.clientId);
  check('payer_group', table.payer_group, input.payerGroup);
  check('payer', table.payer, input.payerName);
  check('origin_state', table.origin_state, input.originState);
  check('destination_state', table.destination_state, input.destinationState);
  check('origin_municipality', table.origin_municipality, input.originMunicipality);
  check('destination_municipality', table.destination_municipality, input.destinationMunicipality);
  checkContains('origin_region', table.origin_region, input.origin);
  checkContains('destination_region', table.destination_region, input.destination);
  check('route', table.route, input.route);
  check('distribution_type', table.distribution_type, input.distributionType);
  check('cargo_type', table.cargo_type, input.cargoType);
  check('vehicle_type', table.vehicle_type, input.vehicleType);
  check('body_type', table.body_type, input.bodyType);
  check('ctrc_type', table.ctrc_type, input.ctrcType);

  return { score, eligible, matched, ignored };
}

function computeFreightValue(table: FreightTable, input: FreightInput): FreightBreakdown['components'] {
  const ratePercent = Number(table.rate_percent) || 0;
  const rateValue = input.totalValue * (ratePercent / 100);
  const fixedValue = Number(table.fixed_value) || 0;
  const perKgValue = Number(table.per_kg_value) || 0;
  const perKgTotal = input.totalWeight * perKgValue;
  const perPalletValue = Number(table.per_pallet_value) || 0;
  const perPalletTotal = input.totalPallets * perPalletValue;
  const dispatchValue = Number(table.dispatch_value) || 0;
  const trackingValue = Number(table.tracking_value) || 0;
  const tollValue = Number(table.toll_value) || 0;
  const loadingValue = Number(table.loading_value) || 0;
  const grisValue = Number(table.gris_value) || 0;
  const insurancePercent = Number(table.insurance_percent) || 0;
  const insuranceValue = input.totalValue * (insurancePercent / 100);

  return {
    ratePercent, rateValue, fixedValue,
    perKgValue, perKgTotal,
    perPalletValue, perPalletTotal,
    dispatchValue, trackingValue, tollValue, loadingValue, grisValue,
    insurancePercent, insuranceValue,
  };
}

export async function calculateFreight(input: FreightInput): Promise<FreightResult> {
  const metricError = freightMetricValidationError(input);
  if (metricError) return { success: false, value: 0, breakdown: null, error: metricError };
  const today = input.referenceDate?.slice(0, 10) || localDateInputValue();

  // ===== Auto-fallback: detect missing critical fields and substitute with UNKNOWN =====
  const missingFields: string[] = [];
  const unknownSubstitutions: Record<string, string> = {};
  const UNKNOWN = 'UNKNOWN';

  const normalizedInput: FreightInput = { ...input };
  if (!normalizedInput.clientId) {
    missingFields.push('client_id');
    unknownSubstitutions['client_id'] = UNKNOWN;
  }
  if (!normalizedInput.payerGroup) {
    missingFields.push('payer_group');
    unknownSubstitutions['payer_group'] = UNKNOWN;
    normalizedInput.payerGroup = null;
  }
  if (!normalizedInput.destinationState) {
    missingFields.push('destination_state');
    unknownSubstitutions['destination_state'] = UNKNOWN;
  }
  if (!normalizedInput.destinationMunicipality) {
    missingFields.push('destination_municipality');
    unknownSubstitutions['destination_municipality'] = UNKNOWN;
  }
  if (!normalizedInput.destination) {
    missingFields.push('destination');
    unknownSubstitutions['destination'] = UNKNOWN;
  }

  let regionName: string | null = null;
  let regionId: string | null = null;
  if (input.destinationMunicipality) {
    const regions = await fetchAllPostgrestPages((from, to) => {
      let query = supabase.from('client_regions').select('id, region_name, municipality, state_code, client_id, payer_group')
        .eq('tenant_id', input.tenantId).order('id').range(from, to);
      if (input.destinationState) query = query.eq('state_code', input.destinationState);
      if (input.clientId) query = query.eq('client_id', input.clientId);
      if (input.payerGroup) query = query.eq('payer_group', input.payerGroup);
      return query;
    });
    const normalize = (value: string | null | undefined) => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
    const exact = regions.filter(region => normalize(region.municipality) === normalize(input.destinationMunicipality));
    if (exact.length === 1) { regionId = exact[0].id; regionName = exact[0].region_name; }
    else if (exact.length > 1) return { success: false, value: 0, breakdown: null, error: 'Região de destino ambígua para o cliente/UF informados' };
  }
  normalizedInput.destination = regionName || normalizedInput.destination;

  let tables: FreightTable[];
  try {
    tables = await fetchAllPostgrestPages((from, to) => supabase.from('freight_tables').select('*')
      .eq('tenant_id', input.tenantId).eq('blocked', false).lte('valid_from', today)
      .order('table_code', { ascending: false }).order('id').range(from, to)) as FreightTable[];
  } catch (error) { return { success: false, value: 0, breakdown: null, error: error instanceof Error ? error.message : 'Falha ao consultar tabelas' }; }
  if (!tables || tables.length === 0) {
    return { success: false, value: 0, breakdown: null, error: 'Nenhuma tabela de frete ativa encontrada' };
  }

  // Filter by validity
  const valid = tables.filter((table) => !table.valid_until || table.valid_until >= today);
  if (valid.length === 0) {
    return { success: false, value: 0, breakdown: null, error: 'Nenhuma tabela de frete vigente' };
  }

  // Score each table — using normalized input (missing fields treated as wildcards / null)
  const scored = valid.map((table) => {
    const { score, eligible, matched, ignored } = computeSpecificity(table, normalizedInput);
    return { table, score, eligible, matched, ignored };
  });

  // Any explicit mismatch is terminal, independent of how many other criteria match.
  const qualified = scored.filter(s => s.eligible);

  let chosen: typeof scored[0];
  let fallbackUsed = false;
  let fallbackReason: string | undefined;

  if (qualified.length > 0) {
    // Pick highest specificity
    qualified.sort((a, b) => b.score - a.score || (b.table.table_code || 0) - (a.table.table_code || 0));
    if (qualified.length > 1 && qualified[0].score === qualified[1].score) return { success: false, value: 0, breakdown: null, error: 'Mais de uma tabela vigente possui a mesma prioridade para este contexto' };
    chosen = qualified[0];
    // Fallback flag only when the winner is a generic all-wildcard table AND we had
    // missing context — a genuine specific match on an all-null table is NOT fallback.
    const winnerHasAnyCriteria =
      !!chosen.table.client_id || !!chosen.table.payer_group || !!chosen.table.payer ||
      !!chosen.table.origin_state || !!chosen.table.destination_state ||
      !!chosen.table.origin_municipality || !!chosen.table.destination_municipality ||
      !!chosen.table.origin_region || !!chosen.table.destination_region ||
      !!chosen.table.route || !!chosen.table.distribution_type ||
      !!chosen.table.cargo_type || !!chosen.table.vehicle_type ||
      !!chosen.table.body_type || !!chosen.table.ctrc_type;
    if (missingFields.length > 0 && !winnerHasAnyCriteria) {
      fallbackUsed = true;
      fallbackReason = `Campos ausentes substituídos por UNKNOWN: ${missingFields.join(', ')}`;
    }
  } else {
    return { success: false, value: 0, breakdown: null, error: missingFields.length ? `Contexto insuficiente para escolher a tabela: ${missingFields.join(', ')}` : 'Nenhuma tabela compatível' };
  }

  const components = computeFreightValue(chosen.table, normalizedInput);
  const baseValue = components.rateValue + components.fixedValue + components.perKgTotal + components.perPalletTotal
    + components.dispatchValue + components.trackingValue + components.tollValue
    + components.loadingValue + components.grisValue + components.insuranceValue;
  const minValue = Number(chosen.table.min_value) || 0;
  const finalValue = Math.max(baseValue, minValue);

  if (!regionName && missingFields.includes('destination_municipality')) {
    regionName = UNKNOWN;
  }

  const breakdown: FreightBreakdown = {
    tableName: chosen.table.table_name,
    tableId: chosen.table.id,
    tableCode: chosen.table.table_code,
    regionId,
    regionName,
    matchedCriteria: chosen.matched,
    ignoredCriteria: chosen.ignored,
    specificityScore: chosen.score,
    components,
    baseValue,
    minValue,
    finalValue,
    fallbackUsed,
    fallbackReason,
    missingFields: missingFields.length > 0 ? missingFields : undefined,
    unknownSubstitutions: Object.keys(unknownSubstitutions).length > 0 ? unknownSubstitutions : undefined,
  };

  return { success: true, value: finalValue, breakdown };
}

export async function logFreightCalculation(
  tenantId: string,
  entityId: string,
  entityType: string,
  breakdown: FreightBreakdown,
  userId?: string,
): Promise<void> {
  // Upsert by (tenant_id, entity_type, entity_id) — keeps a single current row per CT-e
  const log: TablesInsert<'freight_calculation_log'> = {
    tenant_id: tenantId,
    entity_id: entityId,
    entity_type: entityType,
    freight_table_id: breakdown.tableId,
    freight_table_name: breakdown.tableName,
    region_id: breakdown.regionId,
    region_name: breakdown.regionName,
    matched_criteria: breakdown.matchedCriteria,
    ignored_criteria: [
      ...breakdown.ignoredCriteria,
      ...(breakdown.missingFields?.map(f => `missing:${f}=UNKNOWN`) || []),
    ],
    components: breakdown.components,
    base_value: breakdown.baseValue,
    final_value: breakdown.finalValue,
    fallback_used: breakdown.fallbackUsed,
    fallback_reason: breakdown.fallbackReason || null,
    created_by: userId || null,
  };
  const { error } = await supabase
    .from('freight_calculation_log')
    .upsert(log, { onConflict: 'tenant_id,entity_type,entity_id' });
  if (error) throw error;
}
