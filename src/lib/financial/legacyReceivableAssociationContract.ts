import {z} from 'zod';
const uuid=z.string().uuid(),cents=z.string().regex(/^\d+$/),reason=z.string().trim().min(10).max(2000);
const base={version:z.literal(1),tenant_id:uuid,request_id:uuid};
export const legacyReceivableIssueLabels:Record<string,string>={finance_payment_not_found:'O recebimento não foi encontrado nesta empresa.',finance_legacy_payment_not_found:'O recebimento antigo não foi encontrado nesta empresa.',finance_legacy_receivable_not_found:'O título do recebimento não foi encontrado.',finance_legacy_payment_amount_invalid:'O valor do recebimento antigo precisa ser revisado.',finance_legacy_payment_date_invalid:'A data do recebimento antigo precisa ser revisada.',finance_legacy_payment_account_invalid:'A conta do recebimento antigo precisa ser identificada.',finance_legacy_payment_not_eligible:'Este recebimento usa o fluxo de baixa atual; consulte seu histórico de baixa.',finance_legacy_payment_already_associated:'Este recebimento já tem uma associação ativa. Confira o histórico.',finance_legacy_bank_source_mismatch:'O registro bancário antigo diverge do recebimento. Revise sua origem.',finance_legacy_bank_source_ambiguous:'O mesmo registro bancário antigo aparece em mais de um recebimento. A origem precisa ser esclarecida.',finance_legacy_movement_mismatch:'A entrada não corresponde à conta ou data do recebimento.',finance_movement_overallocated:'A entrada não tem mais capacidade para o recebimento integral.',finance_payment_already_linked:'O recebimento já possui vínculo ativo.',finance_payment_link_mismatch:'O recebimento e a entrada possuem informações incompatíveis.',finance_invalid_payment_movement:'A entrada selecionada não é elegível para este recebimento.',finance_legacy_association_not_found:'A associação antiga não foi encontrada.',finance_legacy_association_already_reversed:'A associação já foi desfeita. Confira o histórico.',finance_access_denied:'Seu acesso financeiro não foi confirmado.',finance_request_conflict:'O identificador do pedido já pertence a outra decisão. Confira o histórico antes de continuar.'};
export const legacyReceivableAssociateCommandSchema=z.object({...base,payment_id:uuid,movement_id:uuid,revision:z.string().min(1),existing_receipt_confirmed:z.literal(true),reason}).strict();
export const legacyReceivableReverseCommandSchema=z.object({...base,link_id:uuid,reason}).strict();
export const legacyReceivablePendingSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('associate'),command:legacyReceivableAssociateCommandSchema}),
 z.object({kind:z.literal('reverse'),command:legacyReceivableReverseCommandSchema}),
]);
export type LegacyReceivablePending=z.infer<typeof legacyReceivablePendingSchema>;
legacyReceivableIssueLabels.finance_legacy_payment_changed='Os dados do recebimento ou de sua origem mudaram. Atualize e faça uma nova revisão antes de associar.';
Object.assign(legacyReceivableIssueLabels,{
 finance_legacy_receipt_not_found:'O recebimento antigo não foi encontrado nesta empresa.',
 finance_legacy_receipt_amount_invalid:'O valor do recebimento precisa ser revisado.',
 finance_legacy_receipt_date_invalid:'A data do recebimento precisa ser revisada.',
 finance_legacy_receipt_account_invalid:'A conta do recebimento precisa ser identificada.',
 finance_legacy_receipt_not_eligible:'Este recebimento já foi tratado pelo fluxo atual, devolvido, convertido em crédito ou corrigido. Confira o histórico do título.',
 finance_legacy_receipt_already_associated:'Este recebimento já possui associação ativa. Confira o histórico.',
 finance_legacy_receipt_bank_mismatch:'O registro bancário antigo diverge do recebimento. Revise a origem.',
 finance_legacy_receipt_bank_ambiguous:'O registro bancário antigo aparece em mais de uma origem. Esclareça os vínculos antes de associar.',
 finance_receipt_movement_incompatible:'A entrada escolhida não corresponde à conta, data ou natureza do recebimento.',
 finance_legacy_receipt_link_mismatch:'Os dados do vínculo divergem do recebimento original.',
 finance_receipt_already_linked:'O recebimento já possui vínculo ativo.',
 finance_receipt_movement_capacity_exceeded:'A entrada não tem capacidade disponível para o recebimento integral.',
 finance_legacy_receipt_association_not_found:'A associação do recebimento não foi encontrada.',
 finance_legacy_receipt_association_already_reversed:'A associação já foi desfeita. Confira o histórico.',
 finance_legacy_receipt_changed:'A origem do recebimento mudou. Atualize e faça uma nova revisão.',
 finance_invalid_receipt_declaration:'Confirme que o recebimento já registrado corresponde integralmente à entrada escolhida.',
});
const result={...base,payment_id:uuid,receivable_id:uuid,movement_id:uuid,link_id:uuid,origin:z.literal('legacy_adoption'),confirmed:z.literal(true)};
export const legacyReceivableAssociateResultSchema=z.object({...result,amount_cents:cents,bank_transaction_id:uuid.nullable(),cash_created:z.literal(false),payment_created:z.literal(false)});
export const legacyReceivableReverseResultSchema=z.object({...result,reversal_id:uuid,released_cents:cents,cash_changed:z.literal(false),payment_changed:z.literal(false)});
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const legacyReceivableContextSchema=z.object({version:z.literal(1),tenant_id:uuid,payment_id:uuid,revision:z.string().min(1),page:z.number().int().positive(),page_size:z.literal(20),total:z.number().int().nonnegative(),
 rows:z.array(z.object({id:uuid,bank_account_id:uuid,account_name:z.string(),beneficiary_name:z.string(),description:z.string(),occurred_on:date,bank_reference:z.string().nullable(),amount_cents:cents,remaining_cents:cents})),
 payment:z.object({id:uuid,receivable_id:uuid,bank_account_id:uuid.nullable(),account_name:z.string().nullable(),payer_name:z.string().nullable(),received_on:date.nullable(),amount_cents:cents.nullable(),bank_transaction_id:uuid.nullable()}),eligible:z.boolean(),issue:z.string().nullable(),active_link:uuid.nullable(),history_total:z.number().int().nonnegative(),
 history:z.array(z.object({id:uuid,movement_id:uuid,amount_cents:cents,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string(),origin:z.literal('legacy_adoption'),reversal:z.object({id:uuid,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string()}).nullable()}))
}).superRefine((data,ctx)=>{if(data.payment_id!==data.payment.id)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Recebimento fora do contexto.'});});
