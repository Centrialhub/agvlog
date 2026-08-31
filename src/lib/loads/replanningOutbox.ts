import { isConfirmedReplanning, isRecord, isReplanningPayload, type ReplanningPayload, type ReplanningResult } from './replanning';

export interface PendingReplanning {
  version: 1; tenantId: string; actorId: string; scope: string; requestId: string; createdAt: string; payload: ReplanningPayload;
}
interface Dependencies {
  storage: Storage; uuid: () => string; changed: () => void; assertContext: () => void;
  lock: <T>(key: string, work: () => Promise<T>) => Promise<T>;
  send: (payload: ReplanningPayload & { request_id: string }) => Promise<{ data: unknown; error: unknown }>;
}
export const REPLANNING_CHANGED = 'agvlog:replanning-changed';
const accountPrefix = (tenant: string, actor: string) => `agvlog:replanning:v1:${encodeURIComponent(tenant)}:${encodeURIComponent(actor)}:`;
const scopeOf = (payload: ReplanningPayload) => `${payload.source_load_id}:${payload.target_load_id}`;
const storageError = () => new Error('Não foi possível acessar a recuperação local do replanejamento. Nenhum novo envio foi iniciado.');
function read(storage: Storage, key: string): PendingReplanning | null {
  try {
    const raw = storage.getItem(key); if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || !isReplanningPayload(value.payload) || typeof value.tenantId !== 'string'
      || typeof value.actorId !== 'string' || !value.actorId || value.tenantId !== value.payload.tenant_id
      || value.scope !== scopeOf(value.payload) || typeof value.requestId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)
      || key !== accountPrefix(value.tenantId, value.actorId) + value.scope
      || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw storageError();
    return value as unknown as PendingReplanning;
  } catch { throw storageError(); }
}
export function pendingReplannings(storage: Storage, tenant: string, actor: string): PendingReplanning[] {
  try {
    const result: PendingReplanning[] = []; const prefix = accountPrefix(tenant, actor);
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index); if (!key?.startsWith(prefix)) continue;
      const value = read(storage, key); if (value) result.push(value);
    }
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch { throw storageError(); }
}
export function createReplanningOutbox(deps: Dependencies) {
  const inflight = new Map<string, Promise<ReplanningResult>>();
  function perform(tenant: string, actor: string, scope: string, payload?: ReplanningPayload): Promise<ReplanningResult> {
    const key = accountPrefix(tenant, actor) + scope;
    if (inflight.has(key)) return inflight.get(key)!;
    const promise = deps.lock(key, async () => {
      deps.assertContext(); let item = read(deps.storage, key); const uncertainBefore = !!item;
      if (item && payload) throw new Error('Há replanejamento sem confirmação. Use “Recuperar replanejamento” antes de editar ou enviar novamente.');
      if (!item) {
        if (!payload || !isReplanningPayload(payload) || payload.tenant_id !== tenant || scope !== scopeOf(payload))
          throw new Error('Não há solicitação válida de replanejamento para enviar.');
        item = { version: 1, tenantId: tenant, actorId: actor, scope, requestId: deps.uuid(), createdAt: new Date().toISOString(),
          payload: JSON.parse(JSON.stringify(payload)) as ReplanningPayload };
        try { deps.storage.setItem(key, JSON.stringify(item)); } catch { throw storageError(); }
        deps.changed();
      }
      const forget = () => { try { deps.storage.removeItem(key); } catch { /* Keep the exact replay if local cleanup fails. */ } deps.changed(); };
      deps.assertContext();
      const { data, error } = await deps.send({ ...item.payload, request_id: item.requestId });
      deps.assertContext();
      if (error) {
        const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
        if (!uncertainBefore && (/^(22|23)/.test(code) || ['40001', '40P01', '55P03', '42501'].includes(code))) forget();
        throw error;
      }
      if (!isConfirmedReplanning(data, item.payload, item.requestId))
        throw new Error('O servidor não confirmou o replanejamento. Use “Recuperar replanejamento”; não envie outra movimentação.');
      forget(); return data;
    });
    inflight.set(key, promise);
    void promise.finally(() => { if (inflight.get(key) === promise) inflight.delete(key); deps.changed(); }).catch(() => {});
    return promise;
  }
  return { submit: (tenant: string, actor: string, payload: ReplanningPayload) => perform(tenant, actor, scopeOf(payload), payload),
    recover: (tenant: string, actor: string, scope: string) => perform(tenant, actor, scope) };
}
