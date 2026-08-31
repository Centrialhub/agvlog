import { isConfirmedItemPreparation, isRecord, isItemPreparationPayload, type ItemPreparationPayload, type ItemPreparationResult } from './itemPreparation';

export interface PendingItemPreparation {
  version: 1; tenantId: string; actorId: string; scope: string; requestId: string; createdAt: string; payload: ItemPreparationPayload;
}
interface Dependencies {
  storage: Storage; uuid: () => string; changed: () => void; assertContext: () => void;
  lock: <T>(key: string, work: () => Promise<T>) => Promise<T>;
  send: (payload: ItemPreparationPayload & { request_id: string }) => Promise<{ data: unknown; error: unknown }>;
}
export const ITEM_PREPARATION_CHANGED = 'agvlog:item-preparation-changed';
const accountPrefix = (tenant: string, actor: string) => `agvlog:item-preparation:v1:${encodeURIComponent(tenant)}:${encodeURIComponent(actor)}:`;
const scopeOf = (payload: ItemPreparationPayload) => `${payload.load_id}:${payload.item_id ?? 'new'}`;
const storageError = () => new Error('Não foi possível acessar a recuperação local da preparação de item. Nenhum novo envio foi iniciado.');
function read(storage: Storage, key: string): PendingItemPreparation | null {
  try {
    const raw = storage.getItem(key); if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || !isItemPreparationPayload(value.payload) || typeof value.tenantId !== 'string'
      || typeof value.actorId !== 'string' || !value.actorId || value.tenantId !== value.payload.tenant_id
      || value.scope !== scopeOf(value.payload) || typeof value.requestId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)
      || key !== accountPrefix(value.tenantId, value.actorId) + value.scope
      || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw storageError();
    return value as unknown as PendingItemPreparation;
  } catch { throw storageError(); }
}
export function pendingItemPreparations(storage: Storage, tenant: string, actor: string): PendingItemPreparation[] {
  try {
    const result: PendingItemPreparation[] = []; const prefix = accountPrefix(tenant, actor);
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index); if (!key?.startsWith(prefix)) continue;
      const value = read(storage, key); if (value) result.push(value);
    }
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch { throw storageError(); }
}
export function createItemPreparationOutbox(deps: Dependencies) {
  const inflight = new Map<string, Promise<ItemPreparationResult>>();
  function perform(tenant: string, actor: string, scope: string, payload?: ItemPreparationPayload): Promise<ItemPreparationResult> {
    const key = accountPrefix(tenant, actor) + scope;
    if (inflight.has(key)) return inflight.get(key)!;
    const promise = deps.lock(key, async () => {
      deps.assertContext(); let item = read(deps.storage, key); const uncertainBefore = !!item;
      if (item && payload) throw new Error('Há preparação de item sem confirmação. Use “Recuperar preparação” antes de editar ou enviar novamente.');
      if (!item) {
        if (!payload || !isItemPreparationPayload(payload) || payload.tenant_id !== tenant || scope !== scopeOf(payload))
          throw new Error('Não há solicitação válida de preparação de item para enviar.');
        item = { version: 1, tenantId: tenant, actorId: actor, scope, requestId: deps.uuid(), createdAt: new Date().toISOString(),
          payload: JSON.parse(JSON.stringify(payload)) as ItemPreparationPayload };
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
      if (!isConfirmedItemPreparation(data, item.payload, item.requestId))
        throw new Error('O servidor não confirmou a preparação de item. Use “Recuperar preparação”; não envie outra movimentação.');
      forget(); return data;
    });
    inflight.set(key, promise);
    void promise.finally(() => { if (inflight.get(key) === promise) inflight.delete(key); deps.changed(); }).catch(() => {});
    return promise;
  }
  return { submit: (tenant: string, actor: string, payload: ItemPreparationPayload) => perform(tenant, actor, scopeOf(payload), payload),
    recover: (tenant: string, actor: string, scope: string) => perform(tenant, actor, scope) };
}
