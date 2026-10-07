import { edgeFunctionErrorMessage } from '@/lib/supabase/edgeFunctionError';

export interface SsxSyncError extends Error {
  retryAt?: string;
  cooldownActive?: boolean;
}

function object(value: unknown): Record<string, unknown> | null {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && !(parsed instanceof Response) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function confirmedSuccess(payload: Record<string, unknown> | null): boolean {
  if (payload?.success !== true || payload.error) return false;
  if (payload.skipped === true) {
    if (typeof payload.last_sync_at !== 'string' || typeof payload.next_sync_available_at !== 'string') return false;
    const last = Date.parse(payload.last_sync_at);
    const next = Date.parse(payload.next_sync_available_at);
    return Number.isFinite(last) && Number.isFinite(next) && next > last;
  }
  return typeof payload.upserted === 'number' && Number.isSafeInteger(payload.upserted) && payload.upserted >= 0;
}

/** Decode the SDK response without consuming the original body or changing retry policy. */
export async function ssxSyncError(error: unknown, data: unknown): Promise<SsxSyncError | null> {
  const candidate = error && typeof error === 'object'
    ? error as { message?: unknown; context?: unknown } : {};
  const response = candidate.context instanceof Response ? candidate.context : undefined;
  let payload: Record<string, unknown> | null = null;
  if (response) {
    try { payload = object(await response.clone().json()); } catch { /* Use SDK/status fallback. */ }
  }
  payload ??= object(candidate.context) ?? object(candidate.message) ?? object(data);
  if (!error && confirmedSuccess(payload)) return null;

  const fallback = 'A sincronização não foi confirmada. Consulte os logs da integração.';
  if (response?.status === 401 || response?.status === 403) {
    return new Error(await edgeFunctionErrorMessage(error, fallback));
  }
  if ((!response || response.status === 409) && payload?.error_class === 'missing_stable_identity') {
    return new Error('A SSX retornou veículos sem o código necessário para sincronizar. Confira os códigos das unidades com o responsável pela integração.');
  }

  const message = response?.status === 429
    ? await edgeFunctionErrorMessage(error, fallback)
    : typeof payload?.error === 'string' ? payload.error
    : await edgeFunctionErrorMessage(error, fallback);
  const result: SsxSyncError = new Error(message);
  const isCooldown = response?.status === 429 || payload?.cooldown_active === true
    || payload?.error_class === 'rate_limited' || typeof payload?.retry_at === 'string';
  if (isCooldown) {
    result.cooldownActive = true;
    if (typeof payload?.retry_at === 'string' && Number.isFinite(Date.parse(payload.retry_at))) {
      result.retryAt = payload.retry_at;
    }
  }
  return result;
}
