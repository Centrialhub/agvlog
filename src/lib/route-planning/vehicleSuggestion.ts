export interface VehicleLite {
  id: string;
  plate: string;
  nickname?: string | null;
  active?: boolean | null;
  max_pallets?: number | null;
  max_weight_kg?: number | null;
  max_volume_m3?: number | null;
  current_driver_id?: string | null;
}

export interface VehicleNeed {
  pallets: number;
  weight_kg: number;
  volume_m3: number;
}

export function suggestBestVehicleForRoute(
  need: VehicleNeed,
  vehicles: VehicleLite[],
  usedVehicleIds: Set<string> = new Set(),
): { vehicle: VehicleLite | null; reason?: string } {
  const actives = vehicles.filter(v => v.active !== false);
  if (actives.length === 0) return { vehicle: null, reason: 'Nenhum veículo ativo cadastrado.' };

  const fits = (v: VehicleLite) => {
    if (v.max_pallets && need.pallets > v.max_pallets) return false;
    if (v.max_weight_kg && need.weight_kg > v.max_weight_kg) return false;
    if (v.max_volume_m3 && need.volume_m3 > v.max_volume_m3) return false;
    return true;
  };

  const compatible = actives.filter(fits);
  if (compatible.length === 0) {
    return { vehicle: null, reason: 'Nenhum veículo comporta a carga.' };
  }

  compatible.sort((a, b) => {
    const usedA = usedVehicleIds.has(a.id) ? 1 : 0;
    const usedB = usedVehicleIds.has(b.id) ? 1 : 0;
    if (usedA !== usedB) return usedA - usedB;
    const capA = a.max_pallets || a.max_weight_kg || Number.MAX_SAFE_INTEGER;
    const capB = b.max_pallets || b.max_weight_kg || Number.MAX_SAFE_INTEGER;
    return capA - capB;
  });

  return { vehicle: compatible[0] };
}