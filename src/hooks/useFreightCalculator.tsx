import { supabase } from '@/integrations/supabase/client';

export interface FreightInput {
  tenantId: string;
  clientId?: string | null;
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

function computeSpecificity(table: any, input: FreightInput): { score: number; matched: Record<string, string>; ignored: string[] } {
  let score = 0;
  const matched: Record<string, string> = {};
  const ignored: string[] = [];

  const check = (field: string, tableVal: string | null, inputVal: string | null | undefined) => {
    if (!tableVal) return; // wildcard
    if (inputVal && tableVal.toLowerCase() === inputVal.toLowerCase()) {
      score += 10;
      matched[field] = tableVal;
    } else {
      score -= 100; // mismatch = disqualify
      ignored.push(`${field}: table="${tableVal}" vs input="${inputVal || '(vazio)'}"`);
    }
  };

  // Soft check: when the input side is missing (null/empty), do NOT disqualify.
  // Only pushes negative on a real mismatch (both sides present and different).
  // This prevents generic all-null tables from being wrongly rejected in favor of
  // a specific-but-mismatched fallback.
  const checkSoft = (field: string, tableVal: string | null, inputVal: string | null | undefined) => {
    if (!tableVal) return;
    if (!inputVal) {
      ignored.push(`${field}: table="${tableVal}" vs input="(vazio)" (não pontua, não desqualifica)`);
      return;
    }
    if (tableVal.toLowerCase() === inputVal.toLowerCase()) {
      score += 10;
      matched[field] = tableVal;
    } else {
      score -= 100;
      ignored.push(`${field}: table="${tableVal}" vs input="${inputVal}"`);
    }
  };

  const checkContains = (field: string, tableVal: string | null, inputVal: string | null | undefined) => {
    if (!tableVal) return;
    if (inputVal && inputVal.toLowerCase().includes(tableVal.toLowerCase())) {
      score += 5;
      matched[field] = tableVal;
    } else {
      score -= 100;
      ignored.push(`${field}: table="${tableVal}" vs input="${inputVal || '(vazio)'}"`);
    }
  };

  // payer_group is treated softly: a table restricted to a payer_group should not be
  // disqualified merely because the input's client hasn't been assigned to that group yet.
  // This is the common source of wrong-fallback selection in production.
  checkSoft('payer_group', table.payer_group, input.payerGroup);
  // payer is compared to the actual client id, not the literal string "client".
  checkSoft('payer', table.payer, input.clientId);
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

  return { score, matched, ignored };
}

function computeFreightValue(table: any, input: FreightInput): FreightBreakdown['components'] {
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
  const today = new Date().toISOString().slice(0, 10);

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

  const { data: tables, error } = await supabase
    .from('freight_tables')
    .select('*')
    .eq('tenant_id', input.tenantId)
    .eq('blocked', false)
    .lte('valid_from', today)
    .order('table_code', { ascending: false });

  if (error) return { success: false, value: 0, breakdown: null, error: error.message };
  if (!tables || tables.length === 0) {
    return { success: false, value: 0, breakdown: null, error: 'Nenhuma tabela de frete ativa encontrada' };
  }

  // Filter by validity
  const valid = tables.filter((t: any) => !t.valid_until || t.valid_until >= today);
  if (valid.length === 0) {
    return { success: false, value: 0, breakdown: null, error: 'Nenhuma tabela de frete vigente' };
  }

  // Score each table — using normalized input (missing fields treated as wildcards / null)
  const scored = valid.map((t: any) => {
    const { score, matched, ignored } = computeSpecificity(t, normalizedInput);
    return { table: t, score, matched, ignored };
  });

  // Filter out disqualified (negative score means hard mismatch)
  const qualified = scored.filter(s => s.score >= 0);

  let chosen: typeof scored[0];
  let fallbackUsed = false;
  let fallbackReason: string | undefined;

  if (qualified.length > 0) {
    // Pick highest specificity
    qualified.sort((a, b) => b.score - a.score);
    chosen = qualified[0];
    // Fallback flag only when the winner is a generic all-wildcard table AND we had
    // missing context — a genuine specific match on an all-null table is NOT fallback.
    const winnerHasAnyCriteria =
      !!chosen.table.payer_group || !!chosen.table.payer ||
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
    // Fallback: use first table (least specific / generic)
    fallbackUsed = true;
    fallbackReason = missingFields.length > 0
      ? `Nenhuma tabela compatível — usando tabela genérica. Campos ausentes: ${missingFields.join(', ')}`
      : 'Nenhuma tabela compatível — usando tabela genérica';
    // Deterministic pick: least-negative score first (closest to matching), then
    // lowest table_code as a stable tiebreaker.
    chosen = scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.table.table_code || 0) - (b.table.table_code || 0);
    })[0];
    fallbackReason += ` — tabela escolhida: #${chosen.table.table_code} ${chosen.table.table_name}`;
  }

  const components = computeFreightValue(chosen.table, normalizedInput);
  const baseValue = components.rateValue + components.fixedValue + components.perKgTotal + components.perPalletTotal
    + components.dispatchValue + components.trackingValue + components.tollValue
    + components.loadingValue + components.grisValue + components.insuranceValue;
  const minValue = Number(chosen.table.min_value) || 0;
  const finalValue = Math.max(baseValue, minValue);

  // Resolve region name
  let regionName: string | null = null;
  let regionId: string | null = null;
  if (normalizedInput.destination) {
    const { data: regions } = await supabase
      .from('client_regions')
      .select('id, region_name')
      .eq('tenant_id', normalizedInput.tenantId)
      .or(`municipality.ilike.%${normalizedInput.destinationMunicipality || normalizedInput.destination}%`)
      .limit(1);
    if (regions && regions.length > 0) {
      regionId = regions[0].id;
      regionName = regions[0].region_name;
    }
  }
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
  await supabase.from('freight_calculation_log').upsert({
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
    components: breakdown.components as any,
    base_value: breakdown.baseValue,
    final_value: breakdown.finalValue,
    fallback_used: breakdown.fallbackUsed,
    fallback_reason: breakdown.fallbackReason || null,
    created_by: userId || null,
  } as any, { onConflict: 'tenant_id,entity_type,entity_id' });
}
