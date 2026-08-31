import {z} from 'zod';
import {closingSourceFilterSchema} from './closingSources';
const id=z.string().uuid();const text=z.string().max(2000).nullable();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);const amount=z.number().finite().min(0).max(999999999999.99);
export const closingHeaderSchema=z.object({client_id:id.nullable().default(null),payer_client_id:id.nullable().default(null),
 title:z.string().trim().min(1).max(250),report_type:z.enum(['weekly','ten_day','fortnightly','monthly','custom']),report_model:z.enum(['summary','detailed','combined']),
 period_start:date,period_end:date,expected_payment_date:date.nullable().optional(),notes:z.string().max(5000).nullable().optional()}).strict();
const detailedRow=z.object({origin:text,remitter:text,recipient:text,destination:text,issue_date:date.nullable(),invoice_number:text,cte_number:text,
 invoice_value:amount,weight_kg:amount,freight_value:amount,delivery_date:date.nullable(),observation:text}).strict();
const summaryRow=z.object({arrival_date:date.nullable(),billing_period:text,weight_kg:amount,invoice_value:amount}).strict();
const importSchema=z.discriminatedUnion('model',[
 z.object({model:z.literal('detailed'),file_name:z.string().min(1).max(255),rows:z.array(detailedRow).min(1).max(500)}).strict(),
 z.object({model:z.literal('summary'),file_name:z.string().min(1).max(255),rows:z.array(summaryRow).min(1).max(500)}).strict(),
]);
const body={version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,reason:z.string().trim().min(5).max(2000),header:closingHeaderSchema};
export const closingDraftSchema=z.discriminatedUnion('mode',[
 z.object({...body,mode:z.literal('system'),system:z.object({filters:closingSourceFilterSchema,options:z.object({allocation:z.enum(['per_nf','cte_by_value','cte_by_weight','first_nf_only']),only_with_cte:z.boolean()}).strict(),revision:z.string().regex(/^[a-f0-9]{32}$/)}).strict()}).strict(),
 z.object({...body,mode:z.literal('spreadsheet'),import:importSchema}).strict(),
]);
export type ClosingDraftPayload=z.infer<typeof closingDraftSchema>;
export type ClosingDraftInput=Omit<Extract<ClosingDraftPayload,{mode:'system'}>,'version'|'tenant_id'|'actor_id'|'request_id'>|
 Omit<Extract<ClosingDraftPayload,{mode:'spreadsheet'}>,'version'|'tenant_id'|'actor_id'|'request_id'>;
const count=z.number().int().nonnegative();
const resultSchema=z.object({version:z.literal(1),status:z.literal('confirmed'),tenant_id:id,actor_id:id,request_id:id,
 report:z.object({id,closing_number:z.string().min(1),status:z.literal('draft')}).strict(),mode:z.enum(['system','spreadsheet']),source_revision:z.string().nullable(),
 item_count:count,summary_count:count,totals:z.object({total_invoice_value:z.number().finite(),total_freight_value:z.number().finite(),total_weight_kg:z.number().finite(),total_volume:z.number().finite(),
  fiscal_document_count:count,cte_count:count,load_count:count,attempt_count:count}).strict()}).strict();
export type ClosingCreationResult=z.infer<typeof resultSchema>;
export function parseClosingCreation(value:unknown,payload:ClosingDraftPayload):ClosingCreationResult{
 const parsed=resultSchema.safeParse(value);if(!parsed.success)throw new Error('Confirmação de fechamento incompatível. Recupere o mesmo pedido antes de criar outro.');
 const row=parsed.data;if(row.actor_id!==payload.actor_id||row.tenant_id!==payload.tenant_id||row.request_id!==payload.request_id||row.mode!==payload.mode
  ||row.source_revision!==(payload.mode==='system'?payload.system.revision:null)||row.item_count!==row.totals.attempt_count
  ||(payload.mode==='system'&&row.item_count===0)
  ||(payload.mode==='spreadsheet'&&(payload.import.model==='summary'?(row.item_count!==0||row.summary_count!==payload.import.rows.length):row.item_count!==payload.import.rows.length)))
  throw new Error('A confirmação não corresponde ao pedido. Recupere o fechamento na sessão original.');return row;
}
export function closingDraftError(error:unknown){
 const raw=error instanceof Error?error.message:typeof error==='object'&&error!==null&&'message' in error?String(error.message):'';
 if(/source_changed|concurrent_change|trip_context_changed/.test(raw))return 'A origem mudou ou está em atualização. Gere uma nova prévia. Se o pedido estiver sem confirmação, recupere-o antes de reenviar.';
 if(/financial_review_required|import_review_required/.test(raw))return 'Este relatório exige revisão financeira antes de fechar ou faturar. A criação do rascunho não aprova os valores.';
 if(raw.includes('not_authorized'))return 'Sua sessão não tem permissão para alterar este fechamento.';
 if(raw.includes('readonly'))return 'Identificação e horários da viagem são dados de origem; não podem ser alterados pelo fechamento.';
 if(raw.includes('trip_group_requires_review'))return 'Os itens desta carga têm dados de viagem diferentes. Concilie o grupo antes de editar; nenhum item foi sobrescrito.';
 if(raw.includes('invalid_'))return 'Confira o período, os valores, os campos e o motivo informado.';
 return raw||'Fechamento não confirmado. Recupere o pedido antes de reenviar.';
}
