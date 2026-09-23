type FuelReading = { fuel_value: number; fuel_unit: string };

export function fuelUnitLabel(unit: string): string {
  if (unit === 'liters') return 'L';
  if (unit === 'percent') return '%';
  return unit.trim() || 'unidade não informada';
}

export function summarizeFuelSeries(readings: FuelReading[]) {
  const first = readings.at(0);
  const last = readings.at(-1);
  const units = new Set(readings.map(reading => reading.fuel_unit));
  const recognizedUnit = first?.fuel_unit === 'liters' || first?.fuel_unit === 'percent';
  const comparable = Boolean(first && last && units.size === 1 && recognizedUnit);
  return {
    first,
    last,
    comparable,
    difference: comparable ? first!.fuel_value - last!.fuel_value : null,
    unavailableReason: units.size > 1 ? 'mixed_units' : comparable ? null : 'unsupported_unit',
  } as const;
}
