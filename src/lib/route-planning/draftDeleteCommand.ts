import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

const id = z.string().uuid();
const revision = z.string().regex(/^[0-9a-f]{64}$/);

const contextSchema = z.object({
  version: z.literal(1),
  tenant_id: id,
  actor_id: id,
  draft_id: id,
  exists: z.boolean(),
  can_delete: z.boolean(),
  status: z.string().nullable(),
  revision: revision.nullable(),
}).strict().superRefine((value, context) => {
  if (value.exists && (!value.status || !value.revision)) {
    context.addIssue({ code: 'custom', message: 'Rascunho existente sem revisão.' });
  }
  if (!value.exists && (value.status !== null || value.revision !== null)) {
    context.addIssue({ code: 'custom', message: 'Rascunho ausente com estado incompatível.' });
  }
});

export type RouteDraftDeleteContext = z.infer<typeof contextSchema>;

export const routeDraftDeleteCommandSchema = z.object({
  version: z.literal(1),
  tenant_id: id,
  actor_id: id,
  request_id: id,
  draft_id: id,
  expected_revision: revision.nullable(),
}).strict();
export type RouteDraftDeleteCommand = z.infer<typeof routeDraftDeleteCommandSchema>;

const resultSchema = z.object({
  version: z.literal(1),
  tenant_id: id,
  actor_id: id,
  request_id: id,
  draft_id: id,
  confirmed: z.literal(true),
  deleted: z.boolean(),
}).strict();
export type RouteDraftDeleteResult = z.infer<typeof resultSchema>;

export function parseRouteDraftDeleteContext(value: unknown, tenantId: string, actorId: string, draftId: string) {
  const parsed = contextSchema.safeParse(value);
  if (!parsed.success
    || parsed.data.tenant_id !== tenantId
    || parsed.data.actor_id !== actorId
    || parsed.data.draft_id !== draftId) {
    throw new Error('Contexto de exclusão do rascunho incompatível com a sessão. Atualize o planejamento.');
  }
  return parsed.data;
}

export function parseRouteDraftDeleteResult(value: unknown, payload: RouteDraftDeleteCommand) {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success
    || parsed.data.tenant_id !== payload.tenant_id
    || parsed.data.actor_id !== payload.actor_id
    || parsed.data.request_id !== payload.request_id
    || parsed.data.draft_id !== payload.draft_id) {
    throw new Error('Confirmação de exclusão incompatível. Atualize o planejamento antes de repetir.');
  }
  return parsed.data;
}

type DraftRpcArgs = {
  get_route_planning_draft_delete_context_v1: { _tenant_id: string; _draft_id: string };
  delete_route_planning_draft_v1: { _payload: RouteDraftDeleteCommand };
};

interface RpcResponse { data: unknown; error: unknown }
const rpc = supabase.rpc as unknown as <Name extends keyof DraftRpcArgs>(
  name: Name,
  args: DraftRpcArgs[Name],
) => PromiseLike<RpcResponse>;

export async function callRouteDraftRpc<Name extends keyof DraftRpcArgs>(name: Name, args: DraftRpcArgs[Name]) {
  return await rpc(name, args);
}

export function routeDraftDeleteError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : typeof cause === 'object' && cause !== null && 'message' in cause
    ? String(cause.message)
    : '';
  if (/not_authorized|permission denied/i.test(message)) return 'Sua sessão não pode excluir rascunhos desta empresa.';
  if (/context_changed|concurrent_change|lock timeout|could not obtain lock/i.test(message)) {
    return 'O rascunho mudou em outra aba ou está em uso. Atualize o planejamento antes de excluir.';
  }
  if (/lifecycle_closed/i.test(message)) return 'A rota já saiu do estado de rascunho e não pode ser excluída.';
  if (/request_key_mismatch|confirmação.*incompatível/i.test(message)) {
    return 'A confirmação não corresponde a esta exclusão. Atualize o planejamento.';
  }
  if (/invalid_payload|invalid input syntax/i.test(message)) return 'A solicitação de exclusão é inválida. Atualize o planejamento.';
  return message || 'Não foi possível confirmar a exclusão do rascunho.';
}
