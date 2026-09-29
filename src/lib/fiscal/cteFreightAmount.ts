export function parseCteFreightAmount(text: string): number | null {
  const trimmed = text.trim();
  const normalized = trimmed.includes(',')
    ? (/^(?:\d+|\d{1,3}(?:\.\d{3})+),(?:\d{0,2})$/.test(trimmed)
      ? trimmed.replace(/\./g, '').replace(',', '.') : '')
    : trimmed;
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100)) ? value : null;
}
