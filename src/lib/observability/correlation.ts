const STORAGE_KEY = "agvlog_correlation_id";

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? "00000000-0000-4000-8000-000000000000";
}

export function getCorrelationId() {
  if (typeof sessionStorage === "undefined") return createId();
  const existing = sessionStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const created = createId();
  sessionStorage.setItem(STORAGE_KEY, created);
  return created;
}
