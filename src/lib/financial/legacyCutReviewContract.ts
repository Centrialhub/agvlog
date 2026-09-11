import {paidMovementVoidLabels} from './paidMovementVoidLabels';
import {z} from 'zod';
const uuid=z.string().uuid(),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/),revision=z.string().regex(/^[a-f0-9]{32}$/),reason=z.string().trim().min(10).max(2000),cents=z.string().regex(/^\d+$/).nullable();
const scope={version:z.literal(1),tenant_id:uuid,account_id:uuid,from:date,to:date};
const blocker=z.object({code:z.string(),source_table:z.string(),source_id:uuid});
const footprint=z.object({payment_id:uuid,link_id:uuid.nullable(),movement_id:uuid,account_id:uuid.nullable(),occurred_on:date.nullable(),amount_cents:cents});
const source=z.object({source_table:z.string(),source_id:uuid,occurred_on:date.nullable(),account_id:uuid.nullable(),amount_cents:cents,movement_ids:z.array(uuid),classification:z.string(),footprints:z.array(footprint).optional(),chain_revision:revision.optional()}).superRefine((data,ctx)=>{
 if(data.classification!=='exact_projection_alias'||!['employee_advances','payroll_entry_items'].includes(data.source_table))return;
 const parts=data.footprints;
 if(!data.chain_revision||!parts?.length||parts.some(part=>!part.link_id||!part.account_id||!part.occurred_on||part.amount_cents===null||BigInt(part.amount_cents)<=0n||part.account_id!==data.account_id||!data.movement_ids.includes(part.movement_id))||new Set(parts.map(part=>part.payment_id)).size!==parts.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Projeção de pagamento sem prova completa.'});
});
const approval=z.object({id:uuid,tenant_id:uuid,bank_account_id:uuid,period_start:date,period_end:date,revision,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string()}).passthrough();
export const legacyCutReviewSchema=z.object({...scope,revision,current:z.boolean(),approved:z.boolean(),can_review:z.boolean(),status:z.enum(['approved','needs_review','not_approved']),review_id:uuid.nullable(),approval:approval.nullable(),history:z.array(approval),blockers:z.array(blocker),manifest:z.object({...scope,revision,classifier_version:z.string(),source_count:z.number().int().nonnegative(),sources:z.array(source),evidence:z.record(z.array(z.unknown())),integrity:z.array(z.unknown()),blockers:z.array(blocker)})}).superRefine((data,ctx)=>{const m=data.manifest,a=data.approval;if(m.tenant_id!==data.tenant_id||m.account_id!==data.account_id||m.from!==data.from||m.to!==data.to||m.revision!==data.revision||m.source_count!==m.sources.length||(a&&(a.tenant_id!==data.tenant_id||a.bank_account_id!==data.account_id||a.period_start!==data.from||a.period_end!==data.to||a.id!==data.review_id)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Manifesto fora do corte.'});for(const item of data.history)if(item.tenant_id!==data.tenant_id||item.bank_account_id!==data.account_id||item.period_start!==data.from||item.period_end!==data.to)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Histórico fora do corte.'});});
export const legacyCutCommandSchema=z.object({...scope,request_id:uuid,revision,reason,sources_reviewed:z.literal(true)}).strict();
export type LegacyCutCommand=z.infer<typeof legacyCutCommandSchema>;
export const legacyCutResultSchema=z.object({...scope,request_id:uuid,review_id:uuid,revision,confirmed:z.literal(true),cash_changed:z.literal(false)});
export const legacyCutIssueLabels:Record<string,string>={legacy_source_date_unknown:'A origem não possui data identificável.',legacy_source_account_unknown:'A conta da origem não está identificada.',legacy_source_requires_resolution:'A origem ainda não possui vínculo monetário inequívoco.',finance_access_denied:'Seu acesso não foi confirmado.',finance_legacy_cut_changed:'As fontes mudaram. Atualize e revise o corte novamente.',finance_legacy_cut_blocked:'Há fontes históricas que precisam ser resolvidas antes de aprovar o corte.'};

legacyCutIssueLabels.finance_legacy_cut_unresolved='Há fontes monetárias sem resolução. Confira os vínculos por ID antes de revisar o corte.';

Object.assign(legacyCutIssueLabels,paidMovementVoidLabels);
