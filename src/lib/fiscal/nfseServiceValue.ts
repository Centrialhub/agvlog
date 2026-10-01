/** Currency is stored in reais. Only a deliberate edit can replace the freight. */
export function resolveNFSeServiceValue(freight: unknown, manualValue?: unknown): number {
  const value = manualValue === undefined ? freight : manualValue;
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return 0;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents / 100 : 0;
}
