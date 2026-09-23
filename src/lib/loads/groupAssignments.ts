type Group = { routeName: string; totalPallets: number };
type Vehicle = { id: string; max_pallets: number | null; current_driver_id?: string | null };
const unchanged = (previous: Map<string, string>, next: Map<string, string>) =>
  previous.size === next.size && [...next].every(([key, value]) => previous.get(key) === value) ? previous : next;

export function suggestGroupVehicles(groups: Group[], vehicles: Vehicle[], previous: Map<string, string>) {
  const next = new Map([...previous].filter(([name]) => groups.some(group => group.routeName === name)));
  const used = new Set(next.values());
  for (const group of [...groups].sort((a, b) => b.totalPallets - a.totalPallets)) {
    if (next.has(group.routeName)) continue; // Includes explicit "Sem veículo".
    const best = vehicles.filter(vehicle => !used.has(vehicle.id) && (vehicle.max_pallets || 0) > 0 && (vehicle.max_pallets || 0) >= group.totalPallets)
      .sort((a, b) => (a.max_pallets || 0) - (b.max_pallets || 0))[0];
    if (best) { next.set(group.routeName, best.id); used.add(best.id); }
  }
  return unchanged(previous, next);
}

export function suggestGroupDrivers(groups: Group[], vehicles: Vehicle[], drivers: { id: string }[], assignments: Map<string, string>, previous: Map<string, string>, manual: Set<string>) {
  const next = new Map<string, string>();
  for (const group of groups) {
    if (manual.has(group.routeName)) { next.set(group.routeName, previous.get(group.routeName) || ''); continue; }
    const driver = vehicles.find(vehicle => vehicle.id === assignments.get(group.routeName))?.current_driver_id;
    if (driver && drivers.some(candidate => candidate.id === driver)) next.set(group.routeName, driver);
  }
  return unchanged(previous, next);
}
