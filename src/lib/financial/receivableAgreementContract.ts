import {z} from 'zod';

const id=z.string().uuid(),cents=z.string().regex(/^\d+$/),positiveCents=z.string().regex(/^[1-9]\d{0,13}$/),revision=z.string().regex(/^[a-f0-9]{32}$/),day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const receivableAgreementInstallmentSchema=z.object({id,amount_cents:positiveCents,due_on:day}).strict();
export const receivableAgreementAllocationSchema=z.object({installment_id:id,amount_cents:positiveCents}).strict();
export const receivableAgreementProposalSchema=z.object({action:z.enum(['create','revise','revoke']),installments:z.array(receivableAgreementInstallmentSchema).max(100)}).strict().superRefine((v,ctx)=>{
 if(v.action==='revoke'&&v.installments.length)ctx.addIssue({code:'custom',message:'A revogação não aceita parcelas.'});
 if(v.action!=='revoke'&&!v.installments.length)ctx.addIssue({code:'custom',message:'Informe ao menos uma parcela.'});
 const ids=new Set(v.installments.map(row=>row.id));if(ids.size!==v.installments.length)ctx.addIssue({code:'custom',message:'As parcelas precisam de identidades distintas.'});
});
const positionInstallment=receivableAgreementInstallmentSchema.extend({agreement_id:id,ordinal:z.number().int().positive(),cash_cents:cents,credit_cents:cents,discount_cents:cents,loss_cents:cents,open_cents:cents.nullable(),status:z.enum(['open','overdue','settled'])}).strict();
export const receivableAgreementPositionSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,verified:z.boolean(),issue:z.string().nullable(),receivable_id:id,agreement_id:id.nullable(),revision, status:z.enum(['none','active','revoked','source_blocked']),open_cents:cents.nullable(),scheduled_open_cents:cents.nullable(),unallocated_open_cents:cents.nullable(),requires_reallocation:z.boolean(),installments:z.array(positionInstallment),history_count:z.number().int().nonnegative()}).strict();
const effects=z.object({cash_changed:z.literal(false),nominal_changed:z.literal(false),open_before_cents:cents.nullable(),open_after_cents:cents.nullable(),scheduled_before_cents:cents.nullable(),scheduled_after_cents:cents.nullable(),unallocated_before_cents:cents.nullable(),unallocated_after_cents:cents.nullable()}).passthrough();
export const receivableAgreementPreviewSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,receivable_id:id,revision,eligible:z.boolean(),can_manage:z.boolean(),can_execute:z.literal(false),blockers:z.array(z.object({code:z.string(),source_ids:z.array(z.union([id,z.string()]))}).passthrough()),target:z.record(z.string(),z.unknown()),agreement:receivableAgreementPositionSchema,effects}).passthrough();
export const receivableAgreementCommandSchema=z.object({version:z.literal(1),tenant_id:id,request_id:id,receivable_id:id,action:z.enum(['create','revise','revoke']),expected_revision:revision,reason:z.string().trim().min(5).max(2000),installments:z.array(receivableAgreementInstallmentSchema).max(100)}).strict().superRefine((v,ctx)=>{const result=receivableAgreementProposalSchema.safeParse({action:v.action,installments:v.installments});if(!result.success)for(const issue of result.error.issues)ctx.addIssue(issue);});
export const receivableAgreementResultSchema=z.object({version:z.literal(1),confirmed:z.literal(true),tenant_id:id,actor_id:id,request_id:id,event_id:id,agreement_id:id,receivable_id:id,action:z.enum(['create','revise','revoke']),cash_changed:z.literal(false),effects:z.record(z.string(),z.unknown())}).passthrough();
export const receivableAgreementHistorySchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,receivable_id:id,revision,offset:z.number().int().nonnegative(),limit:z.number().int().positive(),total:z.number().int().nonnegative(),next_offset:z.number().int().nonnegative().nullable(),rows:z.array(z.record(z.string(),z.unknown()))}).strict();

export type ReceivableAgreementInstallment=z.infer<typeof receivableAgreementInstallmentSchema>;
export type ReceivableAgreementAllocation=z.infer<typeof receivableAgreementAllocationSchema>;
export type ReceivableAgreementProposal=z.infer<typeof receivableAgreementProposalSchema>;
export type ReceivableAgreementPosition=z.infer<typeof receivableAgreementPositionSchema>;
export type ReceivableAgreementPreview=z.infer<typeof receivableAgreementPreviewSchema>;
export type ReceivableAgreementCommand=z.infer<typeof receivableAgreementCommandSchema>;
export type ReceivableAgreementResult=z.infer<typeof receivableAgreementResultSchema>;
export const receivableAgreementStorageKey=(tenant:string,actor:string)=>`agvlog:receivable-agreement:v1:${tenant}:${actor}`;
