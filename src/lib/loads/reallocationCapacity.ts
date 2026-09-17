export interface ReallocationCapacityInput {
  currentPallets: number;
  currentWeightKg: number;
  addedPallets: number;
  addedWeightKg: number;
  maxPallets: number;
  maxWeightKg: number;
}

export function assertReallocationCapacity(input: ReallocationCapacityInput) {
  const projectedPallets = input.currentPallets + input.addedPallets;
  const projectedWeightKg = input.currentWeightKg + input.addedWeightKg;
  const exceedsPallets = input.maxPallets > 0 && projectedPallets > input.maxPallets;
  const exceedsWeight = input.maxWeightKg > 0 && projectedWeightKg > input.maxWeightKg;
  if (!exceedsPallets && !exceedsWeight) return;
  const limits = [
    exceedsPallets ? `${projectedPallets}/${input.maxPallets} paletes` : null,
    exceedsWeight ? `${projectedWeightKg.toLocaleString('pt-BR')}/${input.maxWeightKg.toLocaleString('pt-BR')} kg` : null,
  ].filter(Boolean).join(' e ');
  throw new Error(`A carga de destino excederia a capacidade do veículo (${limits}).`);
}
