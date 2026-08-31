import {z} from 'zod';
import {isRecord} from '@/lib/loads/operationDocumentOutcome';
const id=z.string().uuid(),revision=z.string().regex(/^[a-f0-9]{32}$/),cents=z.number().int().min(-99999999999999).max(99999999999999);
const common={version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,settlement_id:id,reason:z.string().trim().min(5).max(2000),expected_revision:revision};
export const settlementAdjustmentCommandSchema=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('add'),item_id:z.null(),nature:z.enum(['credit','debit']),amount_cents:cents.positive(),description:z.string().trim().min(1).max(500)}).strict(),
 z.object({...common,action:z.literal('remove'),item_id:id,nature:z.null(),amount_cents:z.null(),description:z.null()}).strict(),
]);
export type SettlementAdjustmentCommand=z.infer<typeof settlementAdjustmentCommandSchema>;
type StripEnvelope<T>=T extends unknown?Omit<T,'version'|'tenant_id'|'actor_id'|'request_id'>:never;
export type SettlementAdjustmentInput=StripEnvelope<SettlementAdjustmentCommand>;
const itemSchema=z.object({id,nature:z.string().nullable(),amount_cents:cents.nullable(),description:z.string().nullable(),reason:z.string().nullable(),created_at:z.string()}).strict();
const contextSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,settlement_id:id,status:z.string(),is_manual:z.boolean(),can_add:z.boolean(),can_remove:z.boolean(),requires_reconciliation:z.boolean(),revision,
 items:z.array(itemSchema),totals:z.object({credits_cents:cents.nullable(),debits_cents:cents.nullable(),payable_cents:cents.nullable(),paid_cents:cents.nullable(),balance_cents:cents.nullable()}).strict()}).strict();
export type SettlementAdjustmentContext=z.infer<typeof contextSchema>;
export function parseSettlementAdjustmentContext(value:unknown,tenant:string,actor:string,settlement:string){const parsed=contextSchema.safeParse(value);
 if(!parsed.success||parsed.data.tenant_id!==tenant||parsed.data.actor_id!==actor||parsed.data.settlement_id!==settlement)throw new Error('Contexto de ajuste incompatível com a sessão. Atualize a consulta.');return parsed.data;}
const resultSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,settlement_id:id,command_id:id,item_id:id,action:z.enum(['add','remove']),confirmed:z.literal(true),revision}).strict();
export type SettlementAdjustmentResult=z.infer<typeof resultSchema>;
export function parseSettlementAdjustmentResult(value:unknown,payload:SettlementAdjustmentCommand){const parsed=resultSchema.safeParse(value);
 if(!parsed.success)throw new Error('Ajuste sem confirmação compatível. Recupere o mesmo pedido.');const result=parsed.data;
 if(result.tenant_id!==payload.tenant_id||result.actor_id!==payload.actor_id||result.request_id!==payload.request_id||result.settlement_id!==payload.settlement_id||result.action!==payload.action
  ||(payload.action==='remove'&&result.item_id!==payload.item_id))throw new Error('A confirmação não corresponde ao ajuste. Recupere o pedido na sessão original.');return result;}
export function adjustmentAmountCents(value:string){if(!/^\d{1,12}(?:[.,]\d{1,2})?$/.test(value.trim()))return null;
 const [whole,fraction='']=value.trim().replace(',','.').split('.');const amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));return amount>0&&amount<=99999999999999?amount:null;}
export function settlementAdjustmentError(cause:unknown){const message=cause instanceof Error?cause.message:isRecord(cause)?String(cause.message??''):'';
 if(/mfa_required/.test(message))return 'Confirme a autenticação de dois fatores para ajustar este acerto.';
 if(/not_authorized|permission denied/.test(message))return 'Sua sessão não tem permissão para ajustar este acerto.';
 if(/context_changed|could not obtain lock|lock timeout|deadlock/.test(message))return 'O acerto ou seus dados mudaram ou estão em uso. Atualize a conferência antes de confirmar.';
 if(/requires_reconciliation|source_scope|manual_expense_link/.test(message))return 'O acerto exige conciliação dos dados de origem antes deste ajuste.';
 if(/suspended|release_busy/.test(message))return 'Ajustes temporariamente suspensos. Preserve o pedido e tente novamente após a liberação.';
 if(/adjustment_locked/.test(message))return 'Este acerto não está aberto para ajustes.';
 if(/invalid_|key_mismatch|item_not_found/.test(message))return 'Pedido de ajuste inválido ou desatualizado. Confira os dados antes de tentar novamente.';
 return message||'Não foi possível confirmar o ajuste. Recupere o mesmo pedido antes de criar outro.';}
