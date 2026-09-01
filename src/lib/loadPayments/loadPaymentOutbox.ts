import { isRecord } from '@/lib/loads/operationDocumentOutcome';
import {
  loadPaymentCommandSchema,
  parseLoadPaymentResult,
  type LoadPaymentCommand,
  type LoadPaymentCommandInput,
  type LoadPaymentResult,
} from './loadPaymentCommands';

export const LOAD_PAYMENT_COMMAND_CHANGED = 'agvlog:load-payment-changed';
const keyFor = (tenant: string, actor: string) => `agvlog:load-payment:v1:${tenant}:${actor}`;
const unavailable = () => new Error('Recuperação do pagamento indisponível ou incompatível. Nenhum novo pedido foi enviado.');

export interface PendingLoadPaymentCommand {
  version: 1;
  tenantId: string;
  actorId: string;
  createdAt: string;
  payload: LoadPaymentCommand;
}

export function pendingLoadPaymentCommand(storage: Storage, tenant: string, actor: string): PendingLoadPaymentCommand | null {
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith('agvlog:load-payment:') && key.endsWith(`:${tenant}:${actor}`) && key !== keyFor(tenant, actor)) {
        throw unavailable();
      }
    }
    const raw = storage.getItem(keyFor(tenant, actor));
    if (!raw) return null;
    if (raw.length > 20000) throw unavailable();
    const row: unknown = JSON.parse(raw);
    if (!isRecord(row) || row.version !== 1 || row.tenantId !== tenant || row.actorId !== actor
        || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw unavailable();
    const payload = loadPaymentCommandSchema.parse(row.payload);
    if (payload.tenant_id !== tenant || payload.actor_id !== actor) throw unavailable();
    return { ...row, payload } as PendingLoadPaymentCommand;
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
  send: (payload: LoadPaymentCommand) => Promise<{ data: unknown; error: unknown }>;
}

export function createLoadPaymentOutbox(deps: Dependencies) {
  let inFlight: Promise<LoadPaymentResult> | null = null;
  const run = (tenant: string, actor: string, input?: LoadPaymentCommandInput) => {
    if (inFlight) return inFlight;
    const key = keyFor(tenant, actor);
    const work = deps.lock(key, async () => {
      deps.assertContext();
      let row = pendingLoadPaymentCommand(deps.storage, tenant, actor);
      const uncertain = !!row;
      if (row && input) throw new Error('Há um pagamento sem confirmação. Recupere o pedido existente antes de iniciar outro.');
      if (!row) {
        if (!input) throw new Error('Nenhum pagamento pendente nesta sessão.');
        row = {
          version: 1,
          tenantId: tenant,
          actorId: actor,
          createdAt: new Date().toISOString(),
          payload: loadPaymentCommandSchema.parse({
            ...input, version: 1, tenant_id: tenant, actor_id: actor, request_id: deps.uuid(),
          }),
        };
        try { deps.storage.setItem(key, JSON.stringify(row)); } catch { throw unavailable(); }
        deps.changed();
      }
      const forget = () => {
        try { deps.storage.removeItem(key); } catch { /* exact durable replay remains safe */ }
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
      const result = parseLoadPaymentResult(data, row.payload);
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
    submit: (tenant: string, actor: string, input: LoadPaymentCommandInput) => run(tenant, actor, input),
    recover: (tenant: string, actor: string) => run(tenant, actor),
  };
}
