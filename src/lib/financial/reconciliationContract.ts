import {z} from 'zod';
const uuid=z.string().uuid(),positive=z.string().regex(/^[1-9]\d{0,13}$/),amount=z.number().int().positive().max(99999999999999);
export const reconciliationOptionSchema=z.object({id:uuid,bank_account_id:uuid,day:z.string(),direction:z.enum(['in','out']),amount_cents:positive,
 description:z.string(),counterparty:z.string().nullable(),reference:z.string().nullable(),source_verified:z.boolean()});
export type ReconciliationOption=z.infer<typeof reconciliationOptionSchema>;
export type ReconciliationKind='movements'|'entries';
export const reconciliationOptionsSchema=z.object({version:z.literal(1),tenant_id:uuid,import_id:uuid,bank_account_id:uuid,kind:z.enum(['movements','entries']),
 page:z.number().int().positive(),page_size:z.literal(20),total:z.number().int().nonnegative(),rows:z.array(reconciliationOptionSchema)});
const selection=z.array(uuid).min(1).max(100).refine(ids=>new Set(ids).size===ids.length);
export const reconciliationCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,movement_ids:selection,bank_entry_ids:selection,
 expected_revision:z.string().regex(/^[a-f0-9]{32}$/),reason:z.string().trim().min(10).max(2000),account_evidence:z.string().trim().min(10).max(2000)}).strict();
export type ReconciliationCommand=z.infer<typeof reconciliationCommandSchema>;
export const reconciliationContextSchema=z.object({version:z.literal(1),tenant_id:uuid,revision:z.string().regex(/^[a-f0-9]{32}$/),
 accounts:z.array(z.object({id:uuid,name:z.string(),bank_name:z.string().nullable(),bank_code:z.string().nullable(),branch_number:z.string().nullable(),account_number:z.string().nullable(),account_type:z.string().nullable()})),
 movements:z.array(z.object({id:uuid,tenant_id:uuid,bank_account_id:uuid,direction:z.enum(['in','out']),amount_cents:amount,occurred_on:z.string(),description:z.string(),beneficiary_name:z.string()})),
 entries:z.array(z.object({id:uuid,tenant_id:uuid,bank_account_id:uuid,amount_cents:z.number().int().min(-99999999999999).max(99999999999999).refine(value=>value!==0),posted_on:z.string(),description:z.string(),counterparty_name:z.string().nullable(),active:z.boolean(),
  source_verification:z.object({id:uuid,outcome:z.enum(['rows_match','rows_mismatch','unreadable'])}).nullable()})),
 history:z.array(z.object({id:uuid,reversal_id:uuid.nullable()}))});
export const reconciliationResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,group_id:uuid,amount_cents:positive,manual:z.literal(true),confirmed:z.literal(true)});
export const reconciliationSavedSchema=z.object({actor_id:uuid,import_id:uuid,command:reconciliationCommandSchema,context:reconciliationContextSchema});
export type ReconciliationSaved=z.infer<typeof reconciliationSavedSchema>;
export function checkReconciliation(saved:ReconciliationSaved){
 const {command,context}=saved,account=context.accounts[0],direction=context.movements[0]?.direction;
 if(context.tenant_id!==command.tenant_id||context.revision!==command.expected_revision||context.accounts.length!==1||account.account_type==='cash'
  ||context.movements.length!==command.movement_ids.length||context.entries.length!==command.bank_entry_ids.length
  ||new Set(context.movements.map(row=>row.id)).size!==context.movements.length||new Set(context.entries.map(row=>row.id)).size!==context.entries.length
  ||context.movements.some(row=>row.tenant_id!==command.tenant_id||!command.movement_ids.includes(row.id)||row.bank_account_id!==account.id||row.direction!==direction)
  ||context.entries.some(row=>row.tenant_id!==command.tenant_id||!command.bank_entry_ids.includes(row.id)||row.bank_account_id!==account.id||(row.amount_cents>0)!==(direction==='in')||!row.active||row.source_verification?.outcome!=='rows_match')
  ||context.history.some(row=>!row.reversal_id))throw new Error('Selecione registros disponíveis, com original conferido, na mesma conta e no mesmo sentido.');
 const total=context.movements.reduce((sum,row)=>sum+BigInt(row.amount_cents),0n),bankTotal=context.entries.reduce((sum,row)=>sum+BigInt(Math.abs(row.amount_cents)),0n);
 if(total!==bankTotal||total<=0n||total>99999999999999n)throw new Error('Os totais precisam ser iguais. Confira a diferença antes de conciliar.');
 return total.toString();
}
export function reconciliationGuardError(cause:unknown){const message=cause instanceof Error?cause.message:typeof cause==='object'&&cause!==null&&'message' in cause?String(cause.message):'';if(message==='finance_reconciliation_movement_inactive')return 'Um movimento selecionado foi invalidado. Atualize a seleção e confira os registros ativos; o histórico da conciliação permanece preservado.';if(message==='finance_dependency_busy')return 'Outra operação está alterando uma dependência desta conciliação. Atualize e revise novamente.';return null;}
export function reconciliationError(cause:unknown){
 const guarded=reconciliationGuardError(cause);if(guarded)return guarded;
 const message=cause instanceof Error?cause.message:'';
 if(message.includes('context_changed')||message.includes('already_linked'))return 'Os vínculos mudaram. Atualize a seleção e confira novamente antes de confirmar.';
 if(message.includes('source_not_verified'))return 'Confira o arquivo original antes de conciliar suas linhas.';
 if(message.includes('amount_mismatch'))return 'O total dos lançamentos difere do total selecionado no extrato.';
 if(message.includes('account_or_direction'))return 'Selecione a mesma conta e o mesmo sentido de movimentação.';
 if(message.includes('access_denied'))return 'Acesso financeiro não permitido.';
 return 'Não foi possível confirmar a resposta. Retome o mesmo pedido preservado.';
}
