export type JsonObject = Record<string, unknown>;

type SnapshotItem = { external_key: string; payload: JsonObject };
type NormalizationResult =
  | { items: SnapshotItem[]; error: null }
  | { items: null; error: "invalid_schema" | "duplicate_external_key" };

export function normalizeSnapshot(items: JsonObject[], keyField: string): NormalizationResult {
  const result: SnapshotItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const rawKey = item[keyField];
    if ((typeof rawKey !== "string" && typeof rawKey !== "number") || !String(rawKey).trim()) {
      return { items: null, error: "invalid_schema" };
    }
    const externalKey = String(rawKey).trim();
    if (externalKey.length > 200) return { items: null, error: "invalid_schema" };
    if (seen.has(externalKey)) return { items: null, error: "duplicate_external_key" };
    seen.add(externalKey);
    result.push({ external_key: externalKey, payload: item });
  }
  return { items: result, error: null };
}
