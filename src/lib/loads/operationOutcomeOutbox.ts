import { isConfirmedOperationOutcome, isRecord, isOperationOutcomePayload, type OperationOutcomePayload, type OperationOutcomeResult } from './operationDocumentOutcome';

export interface PendingOperationOutcome {
  version: 1|2; tenantId: string; actorId: string; scope: string; requestId: string; createdAt: string; payload: OperationOutcomePayload;
}
interface Dependencies {
  storage: Storage; uuid: () => string; changed: () => void; assertContext: () => void;
  lock: <T>(key: string, work: () => Promise<T>) => Promise<T>;
  send: (payload: OperationOutcomePayload & { request_id: string }) => Promise<{ data: unknown; error: unknown }>;
}
export const OPERATION_OUTCOME_CHANGED = 'agvlog:operation-outcome-changed';
const accountPrefix = (tenant: string, actor: string) => `agvlog:operation-outcome:v1:${encodeURIComponent(tenant)}:${encodeURIComponent(actor)}:`;
const scopeOf = (payload: OperationOutcomePayload) => `${payload.load_id}:${payload.document_id}`;
const storageError = () => new Error('Não foi possível acessar a recuperação local do resultado operacional. Nenhum novo envio foi iniciado.');
function read(storage: Storage, key: string): PendingOperationOutcome | null {
  try {
    const raw = storage.getItem(key); if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || ![1,2].includes(Number(value.version)) || !isOperationOutcomePayload(value.payload)
      || value.version !== (value.payload.correction_of?2:1) || typeof value.tenantId !== 'string'
      || typeof value.actorId !== 'string' || !value.actorId || value.tenantId !== value.payload.tenant_id
      || value.scope !== scopeOf(value.payload) || typeof value.requestId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)
      || key !== accountPrefix(value.tenantId, value.actorId) + value.scope
      || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw storageError();
    return value as unknown as PendingOperationOutcome;
  } catch { throw storageError(); }
}
export function pendingOperationOutcomes(storage: Storage, tenant: string, actor: string): PendingOperationOutcome[] {
  try {
    const result: PendingOperationOutcome[] = []; const prefix = accountPrefix(tenant, actor);
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index); if (!key?.startsWith(prefix)) continue;
      const value = read(storage, key); if (value) result.push(value);
    }
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch { throw storageError(); }
}
export function createOperationOutcomeOutbox(deps: Dependencies) {
  const inflight = new Map<string, Promise<OperationOutcomeResult>>();
  function perform(tenant: string, actor: string, scope: string, payload?: OperationOutcomePayload): Promise<OperationOutcomeResult> {
    const key = accountPrefix(tenant, actor) + scope;
    if (inflight.has(key)) return inflight.get(key)!;
    const promise = deps.lock(key, async () => {
      deps.assertContext(); let item = read(deps.storage, key); const uncertainBefore = !!item;
      if (item && payload) throw new Error('Há resultado operacional sem confirmação. Use “Recuperar resultado” antes de editar ou enviar novamente.');
      if (!item) {
        if (!payload || !isOperationOutcomePayload(payload) || payload.tenant_id !== tenant || scope !== scopeOf(payload))
          throw new Error('Não há solicitação válida de resultado operacional para enviar.');
        item = { version: payload.correction_of?2:1, tenantId: tenant, actorId: actor, scope, requestId: deps.uuid(), createdAt: new Date().toISOString(),
          payload: JSON.parse(JSON.stringify(payload)) as OperationOutcomePayload };
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
      if (!isConfirmedOperationOutcome(data, item.payload, item.requestId))
        throw new Error('O servidor não confirmou o resultado operacional. Use “Recuperar resultado”; não registre outra baixa.');
      forget(); return data;
    });
    inflight.set(key, promise);
    void promise.finally(() => { if (inflight.get(key) === promise) inflight.delete(key); deps.changed(); }).catch(() => {});
    return promise;
  }
  return { submit: (tenant: string, actor: string, payload: OperationOutcomePayload) => perform(tenant, actor, scopeOf(payload), payload),
    recover: (tenant: string, actor: string, scope: string) => perform(tenant, actor, scope) };
}
