export const PRE_TRIP_ITEMS = [
  'Pneus em bom estado', 'Nível de óleo verificado', 'Água do radiador',
  'Luzes funcionando', 'Freios testados', 'Documentos do veículo',
  'Carga conferida e amarrada', 'Espelhos ajustados',
];
export const POST_TRIP_ITEMS = [
  'Veículo estacionado no local correto', 'Chaves entregues', 'Km registrado',
  'Avarias reportadas', 'Veículo limpo',
];

// Reject the whole malformed record: duplicates/extra items must not unlock a gate.
export function checklistItems(payload: unknown, total: number): number[] {
  if (!payload || typeof payload !== 'object' || !('checked_items' in payload)) return [];
  const values = payload.checked_items;
  if (!Array.isArray(values) || values.some(value =>
    typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= total,
  ) || new Set(values).size !== values.length) return [];
  return values as number[];
}

export function driverErrorMessage(error: unknown, fallback: string): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : fallback;
}
