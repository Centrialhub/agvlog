import {z} from 'zod';
const uuid=z.string().uuid();
export const statementReviewCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,row_id:uuid,
  bank_entry_id:uuid.nullable(),decision:z.enum(['same_transaction','distinct_transaction']),reason:z.string().trim().min(10).max(2000),source_verification_id:uuid,previous_review_id:uuid.nullable().optional(),
}).refine(value=>(value.decision==='same_transaction')===(value.bank_entry_id!==null),'Selecione a transação correspondente.');
export type StatementReviewCommand=z.infer<typeof statementReviewCommandSchema>;
export const reviewReversalCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,review_id:uuid,reason:z.string().trim().min(10).max(2000)});
export type ReviewReversalCommand=z.infer<typeof reviewReversalCommandSchema>;
export const reviewReversalResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,review_id:uuid,reversal_id:uuid,row_id:uuid,import_id:uuid,confirmed:z.literal(true),manual:z.literal(true)});
export const identityCandidatesSchema=z.object({tenant_id:uuid,row_id:uuid,page:z.number().int().positive(),total:z.number().int().nonnegative(),
  rows:z.array(z.object({id:uuid,posted_on:z.string(),amount_cents:z.number().int(),description:z.string(),bank_id:z.string().nullable(),counterparty_name:z.string().nullable(),first_import_id:uuid,file_name:z.string(),source_verified:z.boolean()}))});
export const statementReviewResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,row_id:uuid,import_id:uuid,review_id:uuid,
  decision:z.enum(['same_transaction','distinct_transaction']),bank_entry_id:uuid,manual:z.literal(true),confirmed:z.literal(true),reconciliation_status:z.literal('pending')});
export function statementReviewError(error:unknown){
  const message=error instanceof Error?error.message:'';
  if(message.includes('source_review_required'))return 'A conferência do original mudou ou ainda não foi concluída. Atualize o extrato.';
  if(message.includes('target_unverified'))return 'O arquivo de origem da transação escolhida ainda precisa ser conferido.';
  if(message.includes('target_conflict'))return 'A transação escolhida tem conta, data, valor ou documento incompatível.';
  if(message.includes('already_reviewed'))return 'Esta linha já foi revisada. Atualize o extrato para consultar a decisão.';
  if(message.includes('review_changed'))return 'A revisão desta linha mudou. Atualize o extrato antes de registrar outra decisão.';
  if(message.includes('access_denied'))return 'Acesso financeiro não permitido.';
  if(message.includes('has_dependents'))return 'Outras revisões utilizam esta transação. Resolva esses vínculos antes de reverter a decisão.';
  if(message.includes('already_reversed'))return 'Esta decisão já foi revertida. Atualize o extrato para consultar o histórico.';
  return 'Não foi possível confirmar o resultado. Retome o mesmo pedido para evitar duplicidade.';
}
