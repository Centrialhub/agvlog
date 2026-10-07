/** Structural diagnostics only: never include provider values or messages. */
export function ssxResponseDiagnostic(parsed: unknown, text: string, keyField: string) {
  const shape = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
  const keyTypes: Record<string, number> = {};
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const value = item && typeof item === 'object' ? item[keyField] : undefined;
      const kind = value === undefined ? 'missing' : value === null ? 'null'
        : typeof value === 'number'
          ? Number.isInteger(value) ? value < 0 ? 'negative_integer' : 'integer' : 'fractional'
          : typeof value === 'string' ? value.trim() ? 'string' : 'blank_string' : typeof value;
      keyTypes[kind] = (keyTypes[kind] || 0) + 1;
    }
  }
  const hint = /n[aã]o encontrad|not found/i.test(text) ? 'not_found'
    : /limite.*(?:exced|consulta)|rate.?limit|too many/i.test(text) ? 'rate_limited'
    : /filtro|filter/i.test(text) ? 'filter_rejected'
    : /par[aâ]metr|parameter|unsupported media/i.test(text) ? 'parameters_rejected'
    : 'unclassified';
  return { shape, count: Array.isArray(parsed) ? parsed.length : null, key_types: keyTypes, hint };
}
