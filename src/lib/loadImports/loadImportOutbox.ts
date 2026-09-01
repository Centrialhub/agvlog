import { isRecord } from '@/lib/loads/operationDocumentOutcome';
import {
  loadImportCommandSchema, parseLoadImportResult,
  type LoadImportCommand, type LoadImportCommandInput, type LoadImportResult,
} from './loadImportCommands';

export const LOAD_IMPORT_COMMAND_CHANGED = 'agvlog:load-import-changed';
const keyFor = (tenant: string, actor: string) => `agvlog:load-import:v1:${tenant}:${actor}`;
const unavailable = () => new Error('Recuperação da importação indisponível ou incompatível. Nenhum novo pedido foi enviado.');

export interface PendingLoadImportCommand {
  version: 1;
  tenantId: string;
  actorId: string;
  createdAt: string;
  payload: LoadImportCommand;
}

export function pendingLoadImportCommand(storage: Storage, tenant: string, actor: string): PendingLoadImportCommand | null {
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith('agvlog:load-import:') && key.endsWith(`:${tenant}:${actor}`) && key !== keyFor(tenant, actor)) throw unavailable();
    }
    const raw = storage.getItem(keyFor(tenant, actor));
    if (!raw) return null;
    if (raw.length > 2_000_000) throw unavailable();
    const row: unknown = JSON.parse(raw);
    if (!isRecord(row) || row.version !== 1 || row.tenantId !== tenant || row.actorId !== actor
        || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw unavailable();
    const payload = loadImportCommandSchema.parse(row.payload);
    if (payload.tenant_id !== tenant || payload.actor_id !== actor) throw unavailable();
    return { ...row, payload } as PendingLoadImportCommand;
  } catch { throw unavailable(); }
}

interface Dependencies {
  storage: Storage;
  uuid: () => string;
  assertContext: () => void;
  changed: () => void;
  lock: <T>(key: string, work: () => Promise<T>) => Promise<T>;
  send: (payload: LoadImportCommand) => Promise<{ data: unknown; error: unknown }>;
}

export function createLoadImportOutbox(deps: Dependencies) {
  let inFlight: Promise<LoadImportResult> | null = null;
  const run = (tenant: string, actor: string, input?: LoadImportCommandInput) => {
    if (inFlight) return inFlight;
    const key = keyFor(tenant, actor);
    const work = deps.lock(key, async () => {
      deps.assertContext();
      let row = pendingLoadImportCommand(deps.storage, tenant, actor);
      const uncertain = !!row;
      if (row && input) throw new Error('Há uma importação sem confirmação. Recupere o pedido existente antes de selecionar outro arquivo.');
      if (!row) {
        if (!input) throw new Error('Nenhuma importação pendente nesta sessão.');
        row = {
          version: 1, tenantId: tenant, actorId: actor, createdAt: new Date().toISOString(),
          payload: loadImportCommandSchema.parse({ ...input, version: 1, tenant_id: tenant, actor_id: actor, request_id: deps.uuid() }),
        };
        try { deps.storage.setItem(key, JSON.stringify(row)); } catch { throw unavailable(); }
        deps.changed();
      }
      const forget = () => {
        try { deps.storage.removeItem(key); } catch { /* Server replay remains exact. */ }
        deps.changed();
      };
      deps.assertContext();
      const { data, error } = await deps.send(row.payload);
      deps.assertContext();
      if (error) {
        const code = isRecord(error) ? String(error.code ?? '') : '';
        if (!uncertain && (/^(22|23)/.test(code) || ['40001', '40P01', '55P03', '42501', '55000'].includes(code))) forget();
        throw error;
      }
      const result = parseLoadImportResult(data, row.payload);
      forget();
      return result;
    });
    inFlight = work;
    void work.finally(() => {
      if (inFlight === work) inFlight = null;
      deps.changed();
    }).catch(() => {});
    return work;
  };
  return {
    submit: (tenant: string, actor: string, input: LoadImportCommandInput) => run(tenant, actor, input),
    recover: (tenant: string, actor: string) => run(tenant, actor),
  };
}
