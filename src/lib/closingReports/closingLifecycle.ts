import {z} from 'zod';
const id=z.string().uuid();const revision=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const closingActionName=z.enum(['close','cancel','reopen','mark_sent']);
export type ClosingAction=z.infer<typeof closingActionName>;
export const closingActionLabels:Record<ClosingAction,string>={close:'Fechar relatório',cancel:'Cancelar fechamento',reopen:'Reabrir para conferência',mark_sent:'Registrar envio'};
export const closingActionSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,report_id:id,expected_revision:revision,
 action:closingActionName,reason:z.string().trim().min(5).max(2000),sent_to:z.string().max(500).nullable().optional(),channel:z.string().max(100).nullable().optional()}).strict()
 .refine(row=>row.action==='mark_sent'||(row.sent_to===undefined&&row.channel===undefined),'Canal só é permitido ao registrar envio');
export type ClosingActionPayload=z.infer<typeof closingActionSchema>;
export type ClosingActionInput=Omit<ClosingActionPayload,'version'|'tenant_id'|'actor_id'|'request_id'>;
export const closingActionContextSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,report_id:id,closing_number:z.string().min(1),revision,
 status:z.string().min(1),payment_status:z.string(),invoice_status:z.string(),total_amount:z.number().finite().nonnegative(),received_amount:z.number().finite().nonnegative(),open_amount:z.number().finite().nonnegative(),
 has_financial_links:z.boolean(),source_review_required:z.boolean(),allowed_actions:z.array(closingActionName)}).strict();
export type ClosingActionContext=z.infer<typeof closingActionContextSchema>;
export function parseClosingActionContext(value:unknown,tenant:string,actor:string,report:string){
 const data=closingActionContextSchema.safeParse(value);
 if(!data.success||data.data.tenant_id!==tenant||data.data.actor_id!==actor||data.data.report_id!==report)throw new Error('Contexto do fechamento incompatível com a sessão. Atualize antes de confirmar.');
 return data.data;
}
const resultSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,report_id:id,action:closingActionName,confirmed:z.literal(true),
 changed:z.boolean(),closing_number:z.string().min(1),status:z.string(),revision}).strict();
export type ClosingActionResult=z.infer<typeof resultSchema>;
export function parseClosingActionResult(value:unknown,payload:ClosingActionPayload){
 const parsed=resultSchema.safeParse(value);if(!parsed.success)throw new Error('Transição sem confirmação compatível. Recupere o mesmo pedido.');const row=parsed.data;
 const statuses:Record<ClosingAction,string[]>={close:['closed'],cancel:['cancelled'],reopen:['reviewing'],mark_sent:['sent','invoiced']};
 if(row.tenant_id!==payload.tenant_id||row.actor_id!==payload.actor_id||row.report_id!==payload.report_id||row.request_id!==payload.request_id||row.action!==payload.action
  ||!statuses[row.action].includes(row.status)||row.revision!==payload.expected_revision+(row.changed?1:0)||(!row.changed&&row.action!=='mark_sent'))
  throw new Error('A confirmação não corresponde à transição. Recupere o pedido na sessão original.');return row;
}
export function closingLifecycleError(cause:unknown){
 const raw=cause instanceof Error?cause.message:typeof cause==='object'&&cause!==null&&'message' in cause?String(cause.message):'';
 if(/already_reserved|already_invoiced/.test(raw))return 'Esta nota/tentativa já está reservada ou faturada. Concilie o fechamento ou a fatura existente antes de cobrar novamente.';
 if(/financial_reconciliation|financial_ledger|financial_links/.test(raw))return 'O fechamento possui vínculos financeiros. Concilie a fatura e os recebimentos antes de alterar seu estado.';
 if(/context_changed|concurrent_change/.test(raw))return 'O fechamento mudou ou está em uso. Atualize o contexto. Se houver pedido sem confirmação, recupere-o primeiro.';
 if(/requires_review|review_required/.test(raw))return 'A origem exige revisão financeira. O relatório não foi fechado nem faturado.';
 if(/not_authorized/.test(raw))return 'Sua sessão não tem permissão para executar esta ação.';
 if(/invalid_state_transition|reopen_not_allowed/.test(raw))return 'Esta transição não é permitida no estado atual do fechamento.';
 if(/invalid_|no_items/.test(raw))return 'Confira o motivo, os campos e os itens do fechamento antes de confirmar.';
 return raw||'Transição não confirmada. Recupere o pedido antes de reenviar.';
}
