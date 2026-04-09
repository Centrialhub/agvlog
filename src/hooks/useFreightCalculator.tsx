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

  check('payer_group', table.payer_group, input.payerGroup);
  check('payer', table.payer, input.clientId ? 'client' : null); // simplified
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

  // Score each table
  const scored = valid.map((t: any) => {
    const { score, matched, ignored } = computeSpecificity(t, input);
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
  } else {
    // Fallback: use first table (least specific / generic)
    fallbackUsed = true;
    fallbackReason = 'Nenhuma tabela compatível — usando tabela genérica';
    chosen = scored.sort((a, b) => (a.table.specificity_score || 0) - (b.table.specificity_score || 0))[0];
  }

  const components = computeFreightValue(chosen.table, input);
  const baseValue = components.rateValue + components.fixedValue + components.perKgTotal + components.perPalletTotal
    + components.dispatchValue + components.trackingValue + components.tollValue
    + components.loadingValue + components.grisValue + components.insuranceValue;
  const minValue = Number(chosen.table.min_value) || 0;
  const finalValue = Math.max(baseValue, minValue);

  // Resolve region name
  let regionName: string | null = null;
  let regionId: string | null = null;
  if (input.destination) {
    const { data: regions } = await supabase
      .from('client_regions')
      .select('id, region_name')
      .eq('tenant_id', input.tenantId)
      .or(`municipality.ilike.%${input.destinationMunicipality || input.destination}%`)
      .limit(1);
    if (regions && regions.length > 0) {
      regionId = regions[0].id;
      regionName = regions[0].region_name;
    }
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
  await supabase.from('freight_calculation_log').insert({
    tenant_id: tenantId,
    entity_id: entityId,
    entity_type: entityType,
    freight_table_id: breakdown.tableId,
    freight_table_name: breakdown.tableName,
    region_id: breakdown.regionId,
    region_name: breakdown.regionName,
    matched_criteria: breakdown.matchedCriteria,
    ignored_criteria: breakdown.ignoredCriteria,
    components: breakdown.components as any,
    base_value: breakdown.baseValue,
    final_value: breakdown.finalValue,
    fallback_used: breakdown.fallbackUsed,
    fallback_reason: breakdown.fallbackReason || null,
    created_by: userId || null,
  } as any);
}
