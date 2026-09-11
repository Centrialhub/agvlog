import {z} from 'zod';
import {cashOpeningCommandSchema,cashOpeningEvidenceSchema,totalCashCounts} from './cashOpeningContract';
const uuid=z.string().uuid(),cents=z.string().regex(/^-?\d+$/),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const accountOpeningCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,account_id:uuid,from:date,to:date,revision:z.string().min(1),reason:z.string().trim().min(10).max(2000)}).strict();
export const accountOpeningReversalSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,opening_id:uuid,reason:z.string().trim().min(10).max(2000)}).strict();
export type AccountOpeningCommand=z.infer<typeof accountOpeningCommandSchema>;
export type AccountOpeningReversal=z.infer<typeof accountOpeningReversalSchema>;
const opening=z.object({id:uuid,effective_from:date,balance_cents:cents,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string(),evidence_type:z.enum(['cash_count_v1','bank_statement_v1']),evidence:z.union([cashOpeningEvidenceSchema,z.object({opening_anchors:z.array(z.unknown())})])});
export const accountOpeningContextSchema=z.object({version:z.literal(1),tenant_id:uuid,account_id:uuid,from:date,to:date,opening:opening.extend({evidence_status:z.enum(['valid','requires_review'])}).nullable(),book:z.object({opening_cents:cents,in_cents:cents,out_cents:cents,closing_cents:cents}).nullable(),history:z.array(opening.extend({reversal:z.object({id:uuid,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string()}).nullable()})),can_close:z.literal(false)}).superRefine((data,ctx)=>{
 for(const item of [...(data.opening?[data.opening]:[]),...data.history]){
  if(item.evidence_type==='cash_count_v1'){
   const evidence=cashOpeningEvidenceSchema.safeParse(item.evidence);
   if(!evidence.success||evidence.data.effective_from!==item.effective_from||evidence.data.total_cents!==item.balance_cents||totalCashCounts(evidence.data.counts)!==evidence.data.total_cents)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Contagem incompatível com a abertura.'});
  }else if(!('opening_anchors' in item.evidence))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Abertura bancária exige evidência de extrato.'});
 }
});
export const accountOpeningResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,opening_id:uuid,confirmed:z.literal(true),cash_created:z.literal(false)});
export const accountOpeningReversalResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,opening_id:uuid,reversal_id:uuid,confirmed:z.literal(true),cash_changed:z.literal(false)});
export const accountOpeningPendingSchema=z.discriminatedUnion('kind',[z.object({kind:z.literal('record'),command:accountOpeningCommandSchema}),z.object({kind:z.literal('reverse'),command:accountOpeningReversalSchema}),z.object({kind:z.literal('cash'),command:cashOpeningCommandSchema})]);
export type AccountOpeningPending=z.infer<typeof accountOpeningPendingSchema>;
