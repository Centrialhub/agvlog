import type { RouteStopDraft } from './routePlanningTypes';

export interface RouteForValidation {
  loads: Array<{
    id: string;
    destination?: string | null;
    items: Array<{ fiscal_document_id: string | null }>;
    total_pallet_count?: number | null;
    total_weight_kg?: number | null;
    total_volume_m3?: number | null;
  }>;
  stops?: RouteStopDraft[];
  vehicle_id?: string;
  driver_id?: string;
  planned_start_at?: string;
  dirty?: boolean;
}

export interface VehicleCapacity {
  id: string;
  max_pallets?: number | null;
  max_weight_kg?: number | null;
  max_volume_m3?: number | null;
}

export interface ConsistencyResult {
  valid: boolean;
  blockingErrors: string[];
  warnings: string[];
}

/**
 * Pure validator. Returns blockingErrors (must be empty to dispatch) and warnings.
 * Does NOT mutate. Should be the single source of truth for "can this route be dispatched?".
 */
export function validateRouteConsistency(
  route: RouteForValidation,
  context: {
    vehicles?: VehicleCapacity[];
    otherRoutes?: Array<{ id?: string; vehicle_id?: string; driver_id?: string; name?: string }>;
    routeId?: string;
  } = {},
): ConsistencyResult {
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (route.dirty) {
    blocking.push('Cargas foram alteradas após gerar paradas. Recalcule antes de despachar.');
  }

  if (!route.vehicle_id) blocking.push('Selecione um veículo.');
  if (!route.driver_id) blocking.push('Selecione um motorista.');
  if (!route.planned_start_at) blocking.push('Informe horário previsto de saída.');

  if (!route.loads || route.loads.length === 0) {
    blocking.push('Sem cargas vinculadas.');
    return { valid: false, blockingErrors: blocking, warnings };
  }

  const stops = route.stops || [];
  if (stops.length === 0) {
    blocking.push('Sem paradas consolidadas. Clique em "Gerar paradas".');
  }

  const loadIdsSet = new Set(route.loads.map((l) => l.id));
  const allLoadFdIds = new Set<string>();
  const documentLoads=new Map<string,Set<string>>();
  route.loads.forEach(load=>{
    if(load.items.length===0 || load.items.some(item=>!item.fiscal_document_id))
      blocking.push('Há carga sem documentos ou com itens manuais. O fluxo de baixa desses itens ainda precisa ser habilitado.');
    load.items.forEach(item=>{
      if(!item.fiscal_document_id)return;
      const ids=documentLoads.get(item.fiscal_document_id) || new Set<string>();ids.add(load.id);
      documentLoads.set(item.fiscal_document_id,ids);
    });
  });
  route.loads.forEach((l) =>
    l.items.forEach((it) => {
      if (it.fiscal_document_id) allLoadFdIds.add(it.fiscal_document_id);
    }),
  );

  // Loads referenced in stops must exist in route.loads
  const loadsReferencedByStops = new Set<string>();
  const fdSeen = new Map<string, number>(); // fdId -> count across stops
  stops.forEach((s, idx) => {
    const i = idx + 1;
    if (!s.destination?.trim()) blocking.push(`Parada ${i}: destino obrigatório.`);
    if (!s.fiscal_document_ids.length) blocking.push(`Parada ${i}: distribua os documentos desta entrega.`);
    if (!s.city) warnings.push(`Parada ${i}: sem cidade.`);
    s.load_ids.forEach((lid) => {
      if (!loadIdsSet.has(lid)) {
        blocking.push(`Parada ${i}: referencia carga removida da rota.`);
      } else {
        loadsReferencedByStops.add(lid);
      }
    });
    s.fiscal_document_ids.forEach((fdId) => {
      if (!allLoadFdIds.has(fdId)) {
        blocking.push(`Parada ${i}: NF-e não pertence às cargas da rota.`);
      }
      fdSeen.set(fdId, (fdSeen.get(fdId) || 0) + 1);
    });
    const actualLoads=new Set(s.fiscal_document_ids.flatMap(id=>[...(documentLoads.get(id) || [])]));
    if(s.load_ids.length!==actualLoads.size || s.load_ids.some(id=>!actualLoads.has(id)))
      blocking.push(`Parada ${i}: cargas não correspondem aos documentos distribuídos.`);
    if (s.risk_level === 'critical') {
      warnings.push(`Parada ${i}: ${s.risk_reason || 'risco crítico'}.`);
    } else if (s.risk_level === 'warning' && s.risk_reason && !s.risk_reason.startsWith('Cliente sem janela')) {
      warnings.push(`Parada ${i}: ${s.risk_reason}.`);
    }
  });

  // Duplicate FD across distinct stops
  fdSeen.forEach((count, fdId) => {
    if (count > 1) blocking.push(`NF-e ${fdId.slice(0, 8)}… aparece em ${count} paradas diferentes.`);
  });
  allLoadFdIds.forEach(id=>{
    if(!fdSeen.has(id))blocking.push(`NF-e ${id.slice(0,8)}… não aparece em nenhuma parada.`);
    if((documentLoads.get(id)?.size || 0)>1)blocking.push(`NF-e ${id.slice(0,8)}… está vinculada a mais de uma carga.`);
  });

  // Loads not covered by any stop
  if (stops.length > 0) {
    route.loads.forEach((l) => {
      if (!loadsReferencedByStops.has(l.id)) {
        blocking.push(`Carga ${l.destination || l.id.slice(0, 8)} não aparece em nenhuma parada.`);
      }
    });
  }

  // Capacity vs vehicle
  const vehicle = context.vehicles?.find((v) => v.id === route.vehicle_id);
  if (vehicle) {
    const totals = route.loads.reduce(
      (acc, l) => ({
        pallets: acc.pallets + (Number(l.total_pallet_count) || 0),
        weight: acc.weight + (Number(l.total_weight_kg) || 0),
        volume: acc.volume + (Number(l.total_volume_m3) || 0),
      }),
      { pallets: 0, weight: 0, volume: 0 },
    );
    if (vehicle.max_pallets && totals.pallets > vehicle.max_pallets) {
      warnings.push(`Paletes (${totals.pallets}) excedem capacidade (${vehicle.max_pallets}).`);
    }
    if (vehicle.max_weight_kg && totals.weight > vehicle.max_weight_kg) {
      warnings.push(`Peso (${totals.weight.toFixed(0)}kg) excede capacidade (${vehicle.max_weight_kg}kg).`);
    }
    if (vehicle.max_volume_m3 && totals.volume > vehicle.max_volume_m3) {
      warnings.push(`Volume (${totals.volume.toFixed(2)}m³) excede capacidade (${vehicle.max_volume_m3}m³).`);
    }
  }

  // Duplicate vehicle/driver across routes
  if (context.otherRoutes && context.routeId) {
    context.otherRoutes.forEach((other) => {
      if (other.id === context.routeId) return;
      if (route.vehicle_id && other.vehicle_id === route.vehicle_id) {
        blocking.push(`Veículo já alocado em "${other.name || 'outra rota'}".`);
      }
      if (route.driver_id && other.driver_id === route.driver_id) {
        blocking.push(`Motorista já alocado em "${other.name || 'outra rota'}".`);
      }
    });
  }

  return {
    valid: blocking.length === 0,
    blockingErrors: blocking,
    warnings,
  };
}
