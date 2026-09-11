import {z} from 'zod';
const uuid=z.string().uuid(),count=z.number().int().nonnegative();
const evidenceLine=z.object({id:uuid,description:z.string(),counterparty:z.string().nullable(),date:z.string(),amount_cents:z.string().regex(/^-?[1-9]\d{0,13}$/)});
export const reconciliationHistorySchema=z.object({version:z.literal(1),tenant_id:uuid,import_id:uuid,page:z.number().int().positive(),page_size:z.literal(20),total:count,active_count:count,
 rows:z.array(z.object({id:uuid,tenant_id:uuid,bank_account_id:uuid,direction:z.enum(['in','out']),amount_cents:z.string().regex(/^[1-9]\d{0,13}$/),method:z.enum(['manual','automatic_reference']),
  actor_id:uuid,actor_name:z.string(),reason:z.string(),account_evidence:z.string(),created_at:z.string(),movement_count:count,bank_entry_count:count,
  evidence_issue:z.enum(['movement_inactive','group_unavailable','bank_identity_inactive','source_changed','account_changed','automatic_account_unconfirmed','automatic_reference_ambiguous','automatic_bank_reference_contested']).nullable(),movements:z.array(evidenceLine),entries:z.array(evidenceLine),
  reversal:z.object({id:uuid,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string()}).nullable(),
 }))});
export const reconciliationReversalCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,group_id:uuid,reason:z.string().trim().min(10).max(2000)}).strict();
export type ReconciliationReversalCommand=z.infer<typeof reconciliationReversalCommandSchema>;
export const reconciliationReversalResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,group_id:uuid,reversal_id:uuid,manual:z.literal(true),confirmed:z.literal(true)});
export const reconciliationEvidenceIssues={movement_inactive:'Um lançamento desta conciliação foi invalidado. O vínculo e sua autoria permanecem no histórico.',group_unavailable:'O vínculo não está disponível para conferência.',bank_identity_inactive:'A identidade de uma linha bancária precisa ser revista.',source_changed:'Uma nova conferência do original deixou de confirmar as linhas usadas.',account_changed:'Os dados de identificação da conta foram alterados após a conciliação.',automatic_account_unconfirmed:'A identificação nativa da conta deixou de ser única ou confirmada.',automatic_reference_ambiguous:'A referência usada pela automação deixou de identificar um único lançamento.',automatic_bank_reference_contested:'Outra importação contém linhas repetidas ou conflitantes com esta referência bancária. A confirmação automática exige revisão.'};
