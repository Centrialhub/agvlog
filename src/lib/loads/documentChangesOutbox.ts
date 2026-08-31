import { isConfirmedDocumentChange, isRecord, isDocumentChangePayload, type DocumentChangePayload, type DocumentChangeResult } from './documentChanges';

export interface PendingDocumentChange {
  version: 1; tenantId: string; actorId: string; scope: string; requestId: string; createdAt: string; payload: DocumentChangePayload;
}
interface Dependencies {
  storage: Storage; uuid: () => string; changed: () => void; assertContext: () => void;
  lock: <T>(key: string, work: () => Promise<T>) => Promise<T>;
  send: (payload: DocumentChangePayload & { request_id: string }) => Promise<{ data: unknown; error: unknown }>;
}
export const DOCUMENT_CHANGE_CHANGED = 'agvlog:document-change-changed';
const accountPrefix = (tenant: string, actor: string) => `agvlog:documents:v1:${encodeURIComponent(tenant)}:${encodeURIComponent(actor)}:`;
const scopeOf = (payload: DocumentChangePayload) => payload.load_id;
const storageError = () => new Error('Não foi possível acessar a recuperação local da alteração de documentos. Nenhum novo envio foi iniciado.');
function read(storage: Storage, key: string): PendingDocumentChange | null {
  try {
    const raw = storage.getItem(key); if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1 || !isDocumentChangePayload(value.payload) || typeof value.tenantId !== 'string'
      || typeof value.actorId !== 'string' || !value.actorId || value.tenantId !== value.payload.tenant_id
      || value.scope !== scopeOf(value.payload) || typeof value.requestId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)
      || key !== accountPrefix(value.tenantId, value.actorId) + value.scope
      || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw storageError();
    return value as unknown as PendingDocumentChange;
  } catch { throw storageError(); }
}
export function pendingDocumentChanges(storage: Storage, tenant: string, actor: string): PendingDocumentChange[] {
  try {
    const result: PendingDocumentChange[] = []; const prefix = accountPrefix(tenant, actor);
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index); if (!key?.startsWith(prefix)) continue;
      const value = read(storage, key); if (value) result.push(value);
    }
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch { throw storageError(); }
}
export function createDocumentChangeOutbox(deps: Dependencies) {
  const inflight = new Map<string, Promise<DocumentChangeResult>>();
  function perform(tenant: string, actor: string, scope: string, payload?: DocumentChangePayload): Promise<DocumentChangeResult> {
    const key = accountPrefix(tenant, actor) + scope;
    if (inflight.has(key)) return inflight.get(key)!;
    const promise = deps.lock(key, async () => {
      deps.assertContext(); let item = read(deps.storage, key); const uncertainBefore = !!item;
      if (item && payload) throw new Error('Há alteração de documentos sem confirmação. Use “Recuperar alteração” antes de editar ou enviar novamente.');
      if (!item) {
        if (!payload || !isDocumentChangePayload(payload) || payload.tenant_id !== tenant || scope !== scopeOf(payload))
          throw new Error('Não há solicitação válida de alteração de documentos para enviar.');
        item = { version: 1, tenantId: tenant, actorId: actor, scope, requestId: deps.uuid(), createdAt: new Date().toISOString(),
          payload: JSON.parse(JSON.stringify(payload)) as DocumentChangePayload };
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
      if (!isConfirmedDocumentChange(data, item.payload, item.requestId))
        throw new Error('O servidor não confirmou a alteração de documentos. Use “Recuperar alteração”; não envie outra movimentação.');
      forget(); return data;
    });
    inflight.set(key, promise);
    void promise.finally(() => { if (inflight.get(key) === promise) inflight.delete(key); deps.changed(); }).catch(() => {});
    return promise;
  }
  return { submit: (tenant: string, actor: string, payload: DocumentChangePayload) => perform(tenant, actor, scopeOf(payload), payload),
    recover: (tenant: string, actor: string, scope: string) => perform(tenant, actor, scope) };
}
