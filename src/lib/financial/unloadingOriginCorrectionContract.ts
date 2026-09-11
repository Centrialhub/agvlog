import {z} from 'zod';
const uuid=z.string().uuid();
const revision=z.string().regex(/^[a-f0-9]{32}$/);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
const positiveCents=z.string().regex(/^[1-9]\d{0,13}$/);
export const unloadingOriginStateSchema=z.discriminatedUnion('status',[
 z.object({status:z.literal('active'),supplier_id:uuid,supplier_name:z.string().nullable(),amount_cents:positiveCents}).strict(),
 z.object({status:z.literal('cancelled'),supplier_id:uuid,supplier_name:z.string().nullable(),amount_cents:z.literal('0')}).strict(),
]);
const operation=z.enum(['amend_origin','cancel_origin']);
export const unloadingOriginHistorySchema=z.object({id:uuid,previous_id:uuid.nullable(),revision_after:revision,ordinal:z.number().int().positive(),operation,effective_on:day,created_at:z.string(),actor_id:uuid,actor_name:z.string().nullable(),reason:z.string(),before:unloadingOriginStateSchema,after:unloadingOriginStateSchema,economic_effects:z.array(z.object({leg:z.enum(['release','recognize']),supplier_id:uuid,supplier_name:z.string().nullable(),amount_cents:z.string().regex(/^-?\d+$/)}).strict())}).strict();
export const unloadingEffectiveOriginSchema=z.object({version:z.literal(1),tenant_id:uuid,charge_id:uuid,receivable_id:uuid,verified:z.boolean(),issue:z.string().nullable(),original:unloadingOriginStateSchema,effective:unloadingOriginStateSchema.nullable(),revision,history:z.array(unloadingOriginHistorySchema),last_effective_on:day}).strict().superRefine((v,c)=>{
 if(v.verified&&(!v.effective||v.issue!==null))c.addIssue({code:'custom',message:'Origem vigente sem comprovação íntegra.'});
 if(!v.verified&&v.effective!==null)c.addIssue({code:'custom',message:'Origem não comprovada não pode apresentar valor vigente.'});
});
export type UnloadingEffectiveOrigin=z.infer<typeof unloadingEffectiveOriginSchema>;
export const unloadingOriginProposalSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('amend_origin'),supplier_id:uuid,amount_cents:positiveCents,effective_on:day,collection_right_only:z.literal(true)}).strict(),
 z.object({operation:z.literal('cancel_origin'),effective_on:day,collection_right_only:z.literal(true)}).strict(),
]);
export type UnloadingOriginProposal=z.infer<typeof unloadingOriginProposalSchema>;
export const unloadingOriginCorrectionCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,charge_id:uuid,revision,proposal:unloadingOriginProposalSchema,reason:z.string().refine(v=>v.trim().length>=10&&v.trim().length<=2000)}).strict();
export type UnloadingOriginCorrectionCommand=z.infer<typeof unloadingOriginCorrectionCommandSchema>;
export const unloadingOriginCorrectionResultSchema=z.object({version:z.literal(1),tenant_id:uuid,actor_id:uuid,request_id:uuid,charge_id:uuid,receivable_id:uuid,amendment_id:uuid,confirmed:z.literal(true),cash_changed:z.literal(false),cost_changed:z.literal(false),payable_changed:z.literal(false)}).strict();
export function parseUnloadingOriginCorrectionResult(value:unknown,command:UnloadingOriginCorrectionCommand,actorId:string,receivableId:string){const result=unloadingOriginCorrectionResultSchema.parse(value);if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id||result.charge_id!==command.charge_id||result.actor_id!==actorId||result.receivable_id!==receivableId)throw new Error('Resposta incompatível com a correção de cobrança preservada.');return result;}
export const unloadingOriginCorrectionContextSchema=z.object({version:z.literal(1),tenant_id:uuid,actor_id:uuid,charge_id:uuid,receivable_id:uuid,original:unloadingOriginStateSchema,effective:unloadingOriginStateSchema.nullable(),proposal:unloadingOriginProposalSchema,target:unloadingOriginStateSchema.nullable(),history:z.array(unloadingOriginHistorySchema),dependencies:z.array(z.object({source_table:z.string(),source_id:uuid.nullable(),blocking:z.boolean(),reason:z.string()}).strict()),blockers:z.array(z.object({code:z.string(),source_table:z.string().nullable(),source_ids:z.array(uuid)}).strict()),eligible:z.boolean(),can_correct:z.boolean(),can_execute:z.boolean(),effects:z.object({computation:z.literal('prospective_origin_correction'),cash_changed:z.literal(false),cost_changed:z.literal(false),payable_changed:z.literal(false),receivable_changed:z.literal(true)}).strict(),origin_revision:revision,revision}).strict().superRefine((v,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message});
 if(v.eligible!==!v.blockers.length||(v.eligible&&(!v.effective||!v.target||v.dependencies.some(d=>d.blocking))))fail('Elegibilidade incompatível com as evidências.');
 if(v.can_execute&&(!v.eligible||!v.can_correct))fail('Confirmação sem elegibilidade e permissão.');
 if(v.target&&v.proposal.operation==='amend_origin'&&(v.target.status!=='active'||v.target.supplier_id!==v.proposal.supplier_id||v.target.amount_cents!==v.proposal.amount_cents))fail('Destino diferente da proposta.');
 if(v.target&&v.proposal.operation==='cancel_origin'&&(v.target.status!=='cancelled'||v.target.supplier_id!==v.effective?.supplier_id))fail('Cancelamento diferente da cobrança vigente.');
});
export type UnloadingOriginCorrectionContext=z.infer<typeof unloadingOriginCorrectionContextSchema>;
