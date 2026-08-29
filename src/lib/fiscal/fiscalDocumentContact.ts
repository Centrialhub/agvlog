/**
 * Reads optional contact/address fields from imported fiscal documents.
 *
 * Older importers stored these values as top-level compatibility fields while
 * newer ones may preserve them inside `delivery_meta`. Keeping the lookup in
 * one place avoids unchecked casts in the NFS-e forms.
 */
export function fiscalDocumentText(document: unknown, ...keys: string[]): string {
  if (!isRecord(document)) return '';
  const deliveryMeta = isRecord(document.delivery_meta) ? document.delivery_meta : null;
  for (const key of keys) {
    const value = document[key] ?? deliveryMeta?.[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
