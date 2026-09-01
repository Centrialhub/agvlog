import { isRecord } from '@/lib/loads/operationDocumentOutcome';
import {
  loadAggregateCommandSchema, parseLoadAggregateResult,
  type LoadAggregateCommand, type LoadAggregateCommandInput, type LoadAggregateResult,
} from './loadAggregateCommands';

export const LOAD_AGGREGATE_COMMAND_CHANGED = 'agvlog:load-aggregate-changed';
const keyFor = (tenant: string, actor: string) => `agvlog:load-aggregate:v1:${tenant}:${actor}`;
const unavailable = () => new Error('Recuperação da alteração de carga indisponível. Nenhum novo pedido foi enviado.');

export interface PendingLoadAggregateCommand {
  version: 1;
  tenantId: string;
  actorId: string;
  createdAt: string;
  payload: LoadAggregateCommand;
}

export function pendingLoadAggregateCommand(
  storage: Storage,
  tenant: string,
  actor: string,
): PendingLoadAggregateCommand | null {
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith('agvlog:load-aggregate:')
          && key.endsWith(`:${tenant}:${actor}`)
          && key !== keyFor(tenant, actor)) throw unavailable();
    }
    const raw = storage.getItem(keyFor(tenant, actor));
    if (!raw) return null;
    if (raw.length > 1_000_000) throw unavailable();
    const row: unknown = JSON.parse(raw);
    if (!isRecord(row) || row.version !== 1 || row.tenantId !== tenant || row.actorId !== actor
        || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw unavailable();
    const payload = loadAggregateCommandSchema.parse(row.payload);
    if (payload.tenant_id !== tenant) throw unavailable();
    return { ...row, payload } as PendingLoadAggregateCommand;
  } catch {
    throw unavailable();
  }
}

interface Dependencies {
  storage: Storage;
  uuid: () => string;
  assertContext: () => void;
  changed: () => void;
  lock: <T>(key: string, work: () => Promise<T>) => Promise<T>;
  send: (payload: LoadAggregateCommand) => Promise<{ data: unknown; error: unknown }>;
}

const errorCode = (error: unknown) => isRecord(error) ? String(error.code ?? '') : '';
const retryableTransport = (error: unknown) => {
  const code = errorCode(error);
  const message = isRecord(error) ? String(error.message ?? '') : error instanceof Error ? error.message : '';
  return !code || code === '57014' || /fetch|network|timeout|abort/i.test(message);
};

export function createLoadAggregateOutbox(deps: Dependencies) {
  let inFlight: Promise<LoadAggregateResult> | null = null;
  const run = (tenant: string, actor: string, input?: LoadAggregateCommandInput) => {
    if (inFlight) return inFlight;
    const key = keyFor(tenant, actor);
    const work = deps.lock(key, async () => {
      deps.assertContext();
      let row = pendingLoadAggregateCommand(deps.storage, tenant, actor);
      const uncertain = !!row;
      if (row && input) throw new Error('Há uma alteração de carga sem confirmação. Recupere-a antes de iniciar outra.');
      if (!row) {
        if (!input) throw new Error('Nenhuma alteração de carga pendente nesta sessão.');
        row = {
          version: 1,
          tenantId: tenant,
          actorId: actor,
          createdAt: new Date().toISOString(),
          payload: loadAggregateCommandSchema.parse({
            ...input, schema_version: 1, tenant_id: tenant, request_id: deps.uuid(),
          }),
        };
        try { deps.storage.setItem(key, JSON.stringify(row)); } catch { throw unavailable(); }
        deps.changed();
      }

      const forget = () => {
        try { deps.storage.removeItem(key); } catch { /* Server replay remains exact. */ }
        deps.changed();
      };
      const send = () => {
        deps.assertContext();
        return deps.send(row!.payload);
      };

      let response = await send();
      if (response.error && retryableTransport(response.error)) response = await send();
      deps.assertContext();
      if (response.error) {
        const code = errorCode(response.error);
        if (!uncertain && (/^(22|23)/.test(code)
            || ['40001', '40P01', '55P03', '42501', '55000'].includes(code))) forget();
        throw response.error;
      }
      const result = parseLoadAggregateResult(response.data, row.payload);
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
    submit: (tenant: string, actor: string, input: LoadAggregateCommandInput) => run(tenant, actor, input),
    recover: (tenant: string, actor: string) => run(tenant, actor),
  };
}
