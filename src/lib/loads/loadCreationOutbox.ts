import type { LoadHeaderChanges } from './loadAggregateCommands';

export type LoadCreationKind = 'grouped' | 'documents';
export type LoadCreationInput = { changes: LoadHeaderChanges } & Record<string, unknown>;
export interface PendingLoadCreation {
  version: 1; tenant: string; actor: string; kind: LoadCreationKind; scope: string;
  payload: LoadCreationInput & { tenant_id: string; request_id: string };
}
export interface LoadCreationResult {
  ok: true; load_id: string; request_id: string; tenant_id: string;
  document_count: number; document_ids: string[]; replayed: boolean;
  manual_document_id?: string | null;
  load: { id: string; load_number: string };
}
const prefix = (tenant: string, actor: string, kind: LoadCreationKind) =>
  `agvlog:load-creation:v1:${tenant}:${actor}:${kind}:`;
const keyFor = (row: PendingLoadCreation) => prefix(row.tenant, row.actor, row.kind) + encodeURIComponent(row.scope);
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
};

export function readPendingLoadCreations(storage: Storage, tenant: string, actor: string, kind: LoadCreationKind) {
  const rows: PendingLoadCreation[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix(tenant, actor, kind))) continue;
    const row = JSON.parse(storage.getItem(key) || 'null') as PendingLoadCreation | null;
    if (!row || row.version !== 1 || row.tenant !== tenant || row.actor !== actor || row.kind !== kind
      || !row.payload?.request_id || row.payload.tenant_id !== tenant || keyFor(row) !== key) {
      throw new Error('Não foi possível ler a criação pendente. Preserve esta sessão e consulte a carga antes de reenviar.');
    }
    rows.push(row);
  }
  return rows;
}

interface Dependencies {
  storage: Storage; uuid: () => string; assertContext: () => void;
  lock: <T>(key: string, work: () => Promise<T>) => Promise<T>;
  send: (kind: LoadCreationKind, payload: PendingLoadCreation['payload']) => Promise<{ data: unknown; error: unknown }>;
}
const definitive = (error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return /^(22|23)/.test(code) || ['42501', 'P0001', '40001', '40P01', '55P03'].includes(code);
};

export function createLoadCreationOutbox(deps: Dependencies) {
  return async (tenant: string, actor: string, kind: LoadCreationKind, scope: string, input?: LoadCreationInput): Promise<LoadCreationResult> => {
    const key = prefix(tenant, actor, kind) + encodeURIComponent(scope);
    return deps.lock(key, async () => {
      deps.assertContext();
      let row = readPendingLoadCreations(deps.storage, tenant, actor, kind).find(item => item.scope === scope);
      const recovering = !!row;
      if (row && input) {
        const { tenant_id: _tenant, request_id: _request, ...saved } = row.payload;
        if (stable(input) !== stable(saved)) throw new Error('Há uma criação sem confirmação para este grupo. Use Recuperar criação antes de alterar as notas.');
      }
      if (!row) {
        if (!input) throw new Error('Nenhuma criação pendente para recuperar.');
        row = { version: 1, tenant, actor, kind, scope, payload: JSON.parse(JSON.stringify({
          ...input, tenant_id: tenant, request_id: deps.uuid(),
        })) };
        deps.storage.setItem(key, JSON.stringify(row));
        if (deps.storage.getItem(key) !== JSON.stringify(row)) throw new Error('Não foi possível salvar o pedido para recuperação.');
      }
      let response: { data: unknown; error: unknown };
      try { response = await deps.send(kind, row.payload); }
      catch { throw new Error('Criação sem confirmação. Use Recuperar criação para consultar o mesmo pedido.'); }
      deps.assertContext();
      if (response.error) {
        if (!recovering && definitive(response.error)) deps.storage.removeItem(key);
        throw response.error;
      }
      const result = response.data as Partial<LoadCreationResult> | null;
      const ids = kind === 'grouped' ? row.payload.document_ids : row.payload.selected_document_ids;
      const selectedIds = Array.isArray(ids) ? ids : [];
      const expectedCount = selectedIds.length + (kind === 'documents' && row.payload.manual_document ? 1 : 0);
      const confirmedIds = result?.document_ids;
      const sortedSelectedIds = [...selectedIds].sort();
      const sortedConfirmedIds = Array.isArray(confirmedIds) ? [...confirmedIds].sort() : null;
      const matchingDocuments = sortedConfirmedIds !== null
        && sortedConfirmedIds.length === sortedSelectedIds.length
        && selectedIds.every(id => typeof id === 'string')
        && sortedConfirmedIds.every(id => typeof id === 'string')
        && sortedSelectedIds.every((id, index) => id === sortedConfirmedIds[index]);
      if (!result || result.ok !== true || !result.load_id || result.load?.id !== result.load_id
        || result.request_id !== row.payload.request_id || result.tenant_id !== tenant
        || result.document_count !== expectedCount || !matchingDocuments
        || (kind === 'documents' && row.payload.manual_document && !result.manual_document_id)) {
        throw new Error('Criação sem confirmação compatível. Use Recuperar criação.');
      }
      deps.storage.removeItem(key);
      return result as LoadCreationResult;
    });
  };
}
