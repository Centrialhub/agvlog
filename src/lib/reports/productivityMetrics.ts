export interface PalletTripLoad {
  id: string;
  trip_id?: string | null;
  total_pallet_count?: number | null;
  status?: string | null;
}

export interface DeliveryOutcomeLoad {
  status?: string | null;
}

const UNSUCCESSFUL_DELIVERY_STATUSES = new Set([
  'divergent',
  'partial_delivery',
  'returned',
  'refused',
  'failed',
]);

export function deliverySuccessRate(loads: DeliveryOutcomeLoad[]): number | null {
  const delivered = loads.filter(load => load.status === 'delivered').length;
  const unsuccessful = loads.filter(load => UNSUCCESSFUL_DELIVERY_STATUSES.has(load.status ?? '')).length;
  const completedOutcomes = delivered + unsuccessful;
  return completedOutcomes > 0 ? Math.round((delivered / completedOutcomes) * 100) : null;
}

export function averagePalletsPerTrip(loads: PalletTripLoad[]): number {
  const palletsByTrip = new Map<string, number>();
  for (const load of loads) {
    const tripKey = load.trip_id || `load:${load.id}`;
    palletsByTrip.set(tripKey, (palletsByTrip.get(tripKey) ?? 0) + (load.total_pallet_count ?? 0));
  }
  const tripsWithPallets = [...palletsByTrip.values()].filter(pallets => pallets > 0);
  if (tripsWithPallets.length === 0) return 0;
  return Math.round(tripsWithPallets.reduce((sum, pallets) => sum + pallets, 0) / tripsWithPallets.length);
}
