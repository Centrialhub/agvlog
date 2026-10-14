/** Durable limits belong to the immutable request, never to a component mount. */
export interface DriverDeliveryRetry {
  version: 1;
  attempts: number;
  failures: number;
  nextAttemptAt: number | null;
  lastStatus: number | null;
  lastCode: string | null;
}
export const DELIVERY_MAX_ATTEMPTS = 24;
export const DELIVERY_MAX_FAILURES = 5;
export const DELIVERY_QUOTA_WAIT_MS = 60_000;
const remoteConflicts = new Set(['22023','23514','23505','40001','PT409']);
export function deliveryErrorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : 'Não foi possível confirmar o envio. Tente novamente com os mesmos dados.';
}
export function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const value = error as {status?:unknown;context?:{status?:unknown};code?:unknown};
  const status = typeof value.status === 'number' ? value.status : value.context?.status;
  if (typeof status === 'number' && Number.isInteger(status)) return status;
  return typeof value.code === 'string' && /^\d{3}$/.test(value.code) ? Number(value.code) : null;
}
export function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as {code?:unknown}).code;
  return typeof code === 'string' && code ? code : errorStatus(error)?.toString() ?? null;
}
export function isAuthorizationFailure(error: unknown): boolean {
  const code = errorCode(error);
  return errorStatus(error) === 401 || code === '42501'
    || /\b(jwt|token|sess[aã]o)\b.*\b(expir|invalid|ausente)|unauthorized/i.test(deliveryErrorMessage(error));
}
export function isRemoteConflict(error: unknown): boolean {
  const code = errorCode(error);
  return errorStatus(error) === 409 || code === 'delivery_evidence_hash_mismatch'
    || code === 'delivery_evidence_existing_object_mismatch' || (code !== null && remoteConflicts.has(code));
}
export function newDeliveryRetry(previousFailures = 0): DriverDeliveryRetry {
  return {version:1,attempts:0,failures:previousFailures,nextAttemptAt:null,lastStatus:null,lastCode:null};
}
export function isDeliveryRetry(value: unknown): value is DriverDeliveryRetry {
  if (!value || typeof value !== 'object') return false;
  const retry = value as Partial<DriverDeliveryRetry>;
  return retry.version === 1 && Number.isSafeInteger(retry.attempts) && retry.attempts! >= 0
    && Number.isSafeInteger(retry.failures) && retry.failures! >= 0
    && (retry.nextAttemptAt === null || typeof retry.nextAttemptAt === 'number' && Number.isFinite(retry.nextAttemptAt) && retry.nextAttemptAt >= 0)
    && (retry.lastStatus === null || typeof retry.lastStatus === 'number' && Number.isInteger(retry.lastStatus))
    && (retry.lastCode === null || typeof retry.lastCode === 'string');
}
export function deliveryRetryReady(retry: DriverDeliveryRetry | undefined, now = Date.now()): boolean {
  return !retry || retry.nextAttemptAt === null || retry.nextAttemptAt <= now;
}
export function deliveryRetryExhausted(retry: DriverDeliveryRetry): boolean {
  return retry.attempts >= DELIVERY_MAX_ATTEMPTS || retry.failures >= DELIVERY_MAX_FAILURES;
}
export function deliveryFailure(retry: DriverDeliveryRetry, error: unknown, now = Date.now()) {
  const status = errorStatus(error), code = errorCode(error), failures = retry.failures + 1;
  const permanent = status !== null && status >= 400 && status < 500 && ![401,408,409,425,429].includes(status);
  const exhausted = retry.attempts >= DELIVERY_MAX_ATTEMPTS || failures >= DELIVERY_MAX_FAILURES;
  const supplied = error && typeof error === 'object' ? (error as {retryAfterMs?:unknown}).retryAfterMs : undefined;
  const retryAfter = typeof supplied === 'number' && Number.isFinite(supplied) && supplied >= 0 ? supplied : 0;
  const backoff = Math.min(120_000,5_000 * 2 ** Math.min(failures - 1,5));
  const wait = status === 429 ? Math.max(DELIVERY_QUOTA_WAIT_MS,retryAfter,backoff) : Math.max(retryAfter,backoff);
  return {terminal:permanent || exhausted,retry:{...retry,failures,lastStatus:status,lastCode:code,
    nextAttemptAt:permanent || exhausted ? null : now + wait} satisfies DriverDeliveryRetry};
}
/** React Query cancellation does not cancel uploads; share the actual operation. */
export function createDeliverySingleFlight<T>() {
  const flights = new Map<string,Promise<T>>();
  return (tenant: string, actor: string, request: string, operation: () => Promise<T>): Promise<T> => {
    const key = JSON.stringify([tenant,actor,request]);
    const existing = flights.get(key);
    if (existing) return existing;
    const execute = () => typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('agvlog:delivery:' + key,operation) : operation();
    const flight = Promise.resolve().then(execute).finally(() => {if (flights.get(key) === flight) flights.delete(key);});
    flights.set(key,flight);
    return flight;
  };
}
