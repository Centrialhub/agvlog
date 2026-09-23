const nullableOrderFields = [
  'client_id',
  'remitter',
  'recipient',
  'nf_series',
  'issue_date',
  'promised_date',
  'payment_plan',
  'city',
  'neighborhood',
] as const;

export function normalizeOrderOptionalFields<T extends Record<string, string | number | null>>(payload: T): T {
  const normalized: Record<string, string | number | null> = { ...payload };
  for (const field of nullableOrderFields) normalized[field] = normalized[field] || null;
  return normalized as T;
}
