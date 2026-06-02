export interface DriverLite {
  id: string;
  name: string;
  active?: boolean | null;
  current_vehicle_id?: string | null;
}

export function suggestBestDriverForRoute(
  vehicleId: string | undefined,
  drivers: DriverLite[],
  usedDriverIds: Set<string> = new Set(),
): { driver: DriverLite | null; reason?: string } {
  const actives = drivers.filter(d => d.active !== false);
  if (actives.length === 0) return { driver: null, reason: 'Nenhum motorista ativo cadastrado.' };

  if (vehicleId) {
    const linked = actives.find(d => d.current_vehicle_id === vehicleId && !usedDriverIds.has(d.id));
    if (linked) return { driver: linked };
  }
  const free = actives.find(d => !usedDriverIds.has(d.id));
  if (free) return { driver: free };

  return { driver: null, reason: 'Todos os motoristas já estão alocados em outras rotas planejadas.' };
}