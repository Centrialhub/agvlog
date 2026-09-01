import { z } from 'zod';

const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().datetime({ offset: true });
const status = z.enum([
  'active', 'on_time', 'delayed', 'no_update', 'returning',
  'arrived', 'completed', 'waiting_load', 'cancelled', 'issue',
]);
const nullableText = (max: number) => z.string().trim().max(max).nullable();

const monitorChanges = z.object({
  monitor_number: nullableText(80).optional(),
  driver_id: id.nullable().optional(),
  vehicle_id: id.nullable().optional(),
  load_id: id.nullable().optional(),
  driver_name_snapshot: nullableText(200).optional(),
  vehicle_plate_snapshot: nullableText(32).optional(),
  planned_route_text: nullableText(8000).optional(),
  planned_cities: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  started_at: instant.optional(),
  expected_return_date: date.nullable().optional(),
  return_deadline_days: z.number().int().min(0).max(3650).nullable().optional(),
  total_deliveries: z.number().int().min(0).max(1_000_000).optional(),
  notes: nullableText(4000).optional(),
  status: status.optional(),
  actual_returned_at: instant.nullable().optional(),
}).strict();

const context = {
  version: z.literal(1),
  tenant_id: id,
  actor_id: id,
  request_id: id,
  reason: nullableText(2000).optional(),
};

const createCommand = z.object({
  ...context,
  action: z.literal('create'),
  monitor_id: z.null(),
  expected_revision: z.null(),
  changes: monitorChanges.extend({
    driver_name_snapshot: z.string().trim().min(1).max(200),
    started_at: instant,
    total_deliveries: z.number().int().min(0).max(1_000_000),
  }),
}).strict();

const updateCommand = z.object({
  ...context,
  action: z.literal('update'),
  monitor_id: id,
  expected_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  changes: monitorChanges.refine(value => Object.keys(value).length > 0, 'Informe ao menos uma alteração.'),
}).strict();

export const driverMonitorCommandSchema = z.discriminatedUnion('action', [createCommand, updateCommand]);
export type DriverMonitorCommand = z.infer<typeof driverMonitorCommandSchema>;
export type DriverMonitorCommandInput =
  | Omit<z.infer<typeof createCommand>, 'version' | 'tenant_id' | 'actor_id' | 'request_id'>
  | Omit<z.infer<typeof updateCommand>, 'version' | 'tenant_id' | 'actor_id' | 'request_id'>;

const resultSchema = z.object({
  version: z.literal(1),
  tenant_id: id,
  actor_id: id,
  request_id: id,
  action: z.enum(['create', 'update']),
  confirmed: z.literal(true),
  command_id: id,
  monitor_id: id,
  monitor_number: z.string().min(1).max(80),
  status,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  updated_at: z.string(),
}).strict();

export type DriverMonitorCommandResult = z.infer<typeof resultSchema>;

export function parseDriverMonitorCommandResult(
  value: unknown,
  payload: DriverMonitorCommand,
): DriverMonitorCommandResult {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Monitoramento sem confirmação compatível. Recupere o mesmo pedido.');
  }
  const result = parsed.data;
  if (result.tenant_id !== payload.tenant_id
      || result.actor_id !== payload.actor_id
      || result.request_id !== payload.request_id
      || result.action !== payload.action
      || (payload.action === 'update' && result.monitor_id !== payload.monitor_id)) {
    throw new Error('A confirmação não corresponde ao monitoramento. Recupere o pedido na sessão original.');
  }
  return result;
}

export function driverMonitorCommandError(cause: unknown): string {
  const raw = cause instanceof Error
    ? cause.message
    : typeof cause === 'object' && cause !== null && 'message' in cause
      ? String(cause.message)
      : '';
  if (/revision_conflict|concurrent_change/.test(raw)) {
    return 'O monitoramento mudou em outra sessão. Atualize a lista antes de tentar novamente.';
  }
  if (/overlap/.test(raw)) {
    return 'Já existe monitoramento ativo e sobreposto para este motorista, veículo ou carga.';
  }
  if (/duplicate_number/.test(raw)) return 'Já existe monitoramento com este número.';
  if (/not_authorized|permission denied/.test(raw)) {
    return 'Sua sessão não tem permissão para alterar monitoramentos nesta empresa.';
  }
  if (/invalid_driver/.test(raw)) return 'O motorista não pertence à empresa atual.';
  if (/invalid_vehicle/.test(raw)) return 'O veículo não pertence à empresa atual.';
  if (/invalid_load/.test(raw)) return 'A carga não pertence à empresa atual.';
  if (/not_found/.test(raw)) return 'Monitoramento não encontrado na empresa atual.';
  if (/invalid_command|invalid_state|request_key_mismatch/.test(raw)) {
    return 'Confira os dados do monitoramento e atualize a lista antes de repetir.';
  }
  return raw || 'Monitoramento sem confirmação. Recupere o mesmo pedido antes de repetir.';
}
