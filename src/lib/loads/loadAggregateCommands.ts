import { z } from 'zod';

const id = z.string().uuid();
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const changesSchema = z.object({
  load_number: z.string().trim().min(1).max(120).optional(),
  origin: nullableText(500).optional(),
  destination: nullableText(500).optional(),
  notes: nullableText(5000).optional(),
  operation_type: nullableText(120).optional(),
  scheduled_load_at: z.string().datetime({ offset: true }).nullable().optional(),
  estimated_arrival_at: z.string().datetime({ offset: true }).nullable().optional(),
  trailer_plate: nullableText(20).optional(),
  ciot: nullableText(80).optional(),
  distribution_manifest: nullableText(255).optional(),
  shipment_manifest: nullableText(255).optional(),
  driver_id: id.nullable().optional(),
  vehicle_id: id.nullable().optional(),
  merchandise_value: z.number().nonnegative().max(99_999_999_999).nullable().optional(),
  payment_method: nullableText(120).optional(),
}).strict();

const base = {
  schema_version: z.literal(1), tenant_id: id, request_id: id,
};
const createSchema = z.object({
  ...base, action: z.literal('create'), changes: changesSchema,
  reason: z.string().trim().max(500).optional(),
}).strict();
const updateSchema = z.object({
  ...base, action: z.literal('update'), load_id: id,
  expected_version: z.number().int().positive(), changes: changesSchema,
  reason: z.string().trim().max(500).optional(),
}).strict();
const holdSchema = z.object({
  ...base, action: z.literal('hold'), load_id: id,
  expected_version: z.number().int().positive(),
  reason: z.string().trim().min(5).max(500),
}).strict();
const unholdSchema = z.object({
  ...base, action: z.literal('unhold'), load_id: id,
  expected_version: z.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
}).strict();
const deleteSchema = z.object({
  ...base, action: z.literal('delete'), load_id: id,
  expected_version: z.number().int().positive(),
  reason: z.string().trim().min(5).max(500),
}).strict();
const deleteManySchema = z.object({
  ...base, action: z.literal('delete_many'),
  targets: z.array(z.object({
    load_id: id, expected_version: z.number().int().positive(),
  }).strict()).min(1).max(100),
  reason: z.string().trim().min(5).max(500),
}).strict().superRefine((value, context) => {
  const ids = value.targets.map(target => target.load_id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Carga repetida na exclusão.' });
});

export const loadAggregateCommandSchema = z.union([
  createSchema, updateSchema, holdSchema, unholdSchema, deleteSchema, deleteManySchema,
]);
export type LoadAggregateCommand = z.infer<typeof loadAggregateCommandSchema>;
export type LoadAggregateCommandInput = LoadAggregateCommand extends infer Command
  ? Command extends LoadAggregateCommand
    ? Omit<Command, 'schema_version' | 'tenant_id' | 'request_id'>
    : never
  : never;
export type LoadHeaderChanges = z.infer<typeof changesSchema>;

const loadResultSchema = z.object({
  ok: z.literal(true), action: z.enum(['create', 'update', 'hold', 'unhold']),
  load_id: id, version: z.number().int().positive(), load: z.record(z.string(), z.unknown()),
  no_change: z.boolean().optional(), replayed: z.boolean(),
});
const deleteResultSchema = z.object({
  ok: z.literal(true), action: z.enum(['delete', 'delete_many']),
  deleted_load_ids: z.array(id).min(1), replayed: z.boolean(),
});
const resultSchema = z.union([loadResultSchema, deleteResultSchema]);
export type LoadAggregateResult = z.infer<typeof resultSchema>;

export function parseLoadAggregateResult(value: unknown, payload: LoadAggregateCommand): LoadAggregateResult {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success || parsed.data.action !== payload.action) {
    throw new Error('Comando de carga sem confirmação compatível. Recupere o mesmo pedido.');
  }
  if ('load_id' in parsed.data && 'load_id' in payload && parsed.data.load_id !== payload.load_id) {
    throw new Error('A confirmação pertence a outra carga. Recupere o pedido original.');
  }
  if ('deleted_load_ids' in parsed.data) {
    const deletedLoadIds = parsed.data.deleted_load_ids;
    const expected = payload.action === 'delete'
      ? [payload.load_id]
      : payload.action === 'delete_many'
        ? payload.targets.map((target: { load_id: string }) => target.load_id)
        : [];
    if (expected.length !== deletedLoadIds.length
        || expected.some(loadId => !deletedLoadIds.includes(loadId))) {
      throw new Error('A confirmação de exclusão não corresponde às cargas solicitadas.');
    }
  }
  return parsed.data;
}

export function loadAggregateError(cause: unknown): string {
  const raw = cause instanceof Error
    ? cause.message
    : typeof cause === 'object' && cause && 'message' in cause ? String(cause.message) : '';
  if (/load_revision_conflict|load_concurrent_change|40001/.test(raw)) return 'A carga mudou em outra sessão. Atualize a tela e tente novamente.';
  if (/active_trip_requires_replanning/.test(raw)) return 'Motorista, veículo ou rota pertencem a uma viagem ativa. Use o replanejamento.';
  if (/load_.*_locked|load_delete_state_locked/.test(raw)) return 'O estado atual da carga não permite esta alteração.';
  if (/load_delete_has_dependencies/.test(raw)) return 'A carga possui itens, documentos, viagem ou registros financeiros e não pode ser excluída.';
  if (/driver_not_available|vehicle_not_available/.test(raw)) return 'Motorista ou veículo não está disponível nesta empresa.';
  if (/operator_role_required|permission denied|42501/.test(raw)) return 'Sua sessão não pode alterar cargas nesta empresa.';
  if (/request_payload_mismatch/.test(raw)) return 'O pedido salvo não corresponde a esta alteração. Recupere o pedido original.';
  if (/unsupported_load_fields|invalid_|required/.test(raw)) return 'A alteração contém campos inválidos e nada foi salvo.';
  return raw || 'Alteração sem confirmação. Recupere o mesmo pedido antes de reenviar.';
}
