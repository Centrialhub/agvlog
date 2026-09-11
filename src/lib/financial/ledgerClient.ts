import { supabase } from '@/integrations/supabase/client';
import { movementListSchema, movementResultSchema, type MovementCommand, type MovementFilters } from './ledgerContract';
import { expenseOptionsSchema, expenseBatchResultSchema, type ExpenseBatchCommand, type ExpenseOptionKind } from './expenseBatchContract';
import {expenseHistorySchema,type ExpenseFilters} from './expenseHistoryContract';
import type {StatementImportCommand} from './statementImportContract';
import {statementListSchema,statementLinesSchema,type StatementListFilters,type StatementLineFilters} from './statementHistoryContract';
import {identityCandidatesSchema,statementReviewResultSchema,reviewReversalResultSchema,type ReviewReversalCommand,type StatementReviewCommand} from './statementReviewContract';
import {financeAuditSchema,type FinanceAuditFilters} from './financeAuditContract';
import {fiscalQueueSchema,type FiscalQueueStatus} from './fiscalQueueContract';
import {reconciliationOptionsSchema,reconciliationContextSchema,reconciliationResultSchema,type ReconciliationKind,type ReconciliationCommand} from './reconciliationContract';
import {reconciliationHistorySchema,reconciliationReversalResultSchema,type ReconciliationReversalCommand} from './reconciliationHistoryContract';
import {nativeStatementAccountSchema} from './nativeStatementAccountContract';
import {automaticReconciliationSchema} from './automaticReconciliationContract';
import {accountPeriodSchema} from './accountPeriodContract';
import {receiptMovementOptionsSchema} from './receivableMovementContract';
import {receiptCorrectionResultSchema,type ReceiptCorrectionCommand} from './receiptCorrectionContract';
import {movementReceiptTraceSchema} from './movementReceiptTraceContract';
import {internalTransferResultSchema,type InternalTransferCommand} from './internalTransferContract';
import {transferStageResultSchema,pendingTransfersSchema,type TransferStageCommand} from './transferStageContract';
import {transferPeriodSchema} from './transferPeriodContract';
import {manualExpenseResultSchema,manualExpenseOptionsSchema,type ManualExpenseCommand} from './manualExpenseContract';
import {recordedCostsSchema,type RecordedCostFilters} from './recordedCostsContract';
import {payrollProjectionSchema,payrollPeriodsProjectionSchema} from './payrollPaymentContract';
import {payableMovementOptionsSchema,payableMovementResultSchema,payablePaymentHistorySchema,payableReversalResultSchema,type PayableMovementCommand,type PayableReversalCommand} from './payableMovementContract';

// Narrow adapter until the additive migrations are deployed and generated types
// can be refreshed. Every reply is validated before entering the UI cache.
type FinanceRpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
export class FinanceRejectedError extends Error {}
export class FinanceUnavailableError extends Error {
 constructor(){super('O financeiro ainda não está disponível neste ambiente. A atualização do módulo precisa ser concluída.');this.name='FinanceUnavailableError';}
}
export async function readRecordedCosts(tenant:string,filters:RecordedCostFilters){
 const result=recordedCostsSchema.parse(await rpc('list_finance_recorded_costs',{_tenant_id:tenant,_filters:filters}));
 if(result.tenant_id!==tenant||result.page!==filters.page)throw new Error('Custos fora do contexto.');return result;
}
export async function recordManualExpense(command:ManualExpenseCommand){
 const result=manualExpenseResultSchema.parse(await rpc('record_finance_manual_expense',{_payload:command}));
 if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id||result.movement_id!==(command.movement_id||null))throw new Error('Despesa fora do contexto.');return result;
}
export async function readManualExpenseMovements(tenant:string,search:string,page:number){
 const result=manualExpenseOptionsSchema.parse(await rpc('get_finance_manual_expense_movements',{_tenant_id:tenant,_search:search,_page:page}));
 if(result.tenant_id!==tenant||result.page!==page)throw new Error('Saídas fora do contexto.');return result;
}
export async function readTransferPeriod(tenant:string,account:string,cutoff:string,page:number){
 const result=transferPeriodSchema.parse(await rpc('get_finance_transfer_period_position',{_tenant_id:tenant,_account_id:account,_cutoff:cutoff,_page:page}));
 if(result.tenant_id!==tenant||result.account_id!==account||result.cutoff!==cutoff||result.page!==page)throw new Error('Posição de transferências fora do contexto.');return result;
}
export async function recordTransferStage(command:TransferStageCommand){
 const result=transferStageResultSchema.parse(await rpc('record_finance_transfer_stage',{_payload:command}));
 if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id||result.stage!==command.stage||(command.stage==='arrive'&&result.departure_id!==command.departure_id))throw new Error('Etapa de transferência fora do contexto.');return result;
}
export async function readPendingTransfers(tenant:string,page:number){
 const result=pendingTransfersSchema.parse(await rpc('get_finance_pending_transfers',{_tenant_id:tenant,_page:page}));
 if(result.tenant_id!==tenant||result.page!==page)throw new Error('Transferências pendentes fora do contexto.');return result;
}
export async function recordInternalTransfer(command:InternalTransferCommand){
 const result=internalTransferResultSchema.parse(await rpc('record_finance_internal_transfer',{_payload:command}));
 if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id)throw new Error('Transferência fora do contexto.');return result;
}
export async function readMovementReceiptTrace(tenant:string,movement:string,page:number){
 const result=movementReceiptTraceSchema.parse(await rpc('get_finance_movement_receipt_trace',{_tenant_id:tenant,_movement_id:movement,_page:page}));
 if(result.tenant_id!==tenant||result.movement_id!==movement||result.page!==page)throw new Error('Histórico fora do contexto.');return result;
}
export async function correctReceiptAllocation(command:ReceiptCorrectionCommand){
  const result=receiptCorrectionResultSchema.parse(await rpc('correct_finance_receipt_allocation',{_payload:command}));
  if(result.tenant_id!==command.tenant_id||result.payment_id!==command.payment_id||result.request_id!==command.request_id)throw new Error('Correção fora do contexto.');return result;
}
export async function readReceiptMovementOptions(tenant:string,account:string,date:string,search:string,page:number){
  const result=receiptMovementOptionsSchema.parse(await rpc('get_finance_receipt_movement_options',{_tenant_id:tenant,_account_id:account,_date:date,_search:search,_page:page}));
  if(result.tenant_id!==tenant||result.bank_account_id!==account||result.date!==date||result.page!==page)throw new Error('Entradas fora do contexto.');return result;
}
export async function readAccountPeriodReview(tenant:string,account:string,from:string,to:string){
  const result=accountPeriodSchema.parse(await rpc('get_finance_account_period_review',{_tenant_id:tenant,_account_id:account,_from:from,_to:to}));
  if(result.tenant_id!==tenant||result.bank_account_id!==account||result.from!==from||result.to!==to)throw new Error('Período fora do contexto.');return result;
}
export async function readAutomaticReconciliationStatus(tenant:string,statement:string){
  const result=automaticReconciliationSchema.parse(await rpc('get_finance_automatic_reconciliation_status',{_tenant_id:tenant,_import_id:statement}));
  if(result.tenant_id!==tenant||result.import_id!==statement)throw new Error('Conciliação fora do contexto.');return result;
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase.rpc as unknown as FinanceRpc)(name, args);
  if (error) {
    // A PostgreSQL rejection rolled back the transaction; network/unknown
    // failures remain recoverable with the frozen request identity.
    if (/^(22|23|42|40001)/.test(error.code ?? '') && error.message.startsWith('finance_')) throw new FinanceRejectedError(error.message);
    throw new Error(error.message);
  }
  return data;
}
export async function readFinanceAccess(tenant: string) {
  const {data:value,error}=await(supabase.rpc as unknown as FinanceRpc)('get_finance_access',{_tenant_id:tenant});
  if(error){
    if(error.code==='PGRST202'||error.code==='42883')throw new FinanceUnavailableError();
    throw new Error(error.message);
  }
  if (typeof value !== 'boolean') throw new Error('Invalid finance access response');
  return value;
}
export async function readNativeStatementAccount(tenant:string,statement:string,account:string){
 const result=nativeStatementAccountSchema.parse(await rpc('get_finance_native_statement_account',{_tenant_id:tenant,_import_id:statement}));
 if(result.tenant_id!==tenant||result.import_id!==statement||result.bank_account_id!==account)throw new Error('Identificação da conta fora do contexto.');return result;
}
export async function readReconciliationOptions(tenant:string,statement:string,kind:ReconciliationKind,search:string,page:number){
 const result=reconciliationOptionsSchema.parse(await rpc('list_finance_reconciliation_options',{_tenant_id:tenant,_import_id:statement,_kind:kind,_search:search,_page:page}));
 if(result.tenant_id!==tenant||result.import_id!==statement||result.kind!==kind||result.page!==page||result.rows.some(row=>row.bank_account_id!==result.bank_account_id))throw new Error('Opções de conciliação fora do contexto.');return result;
}
export async function readReconciliationHistory(tenant:string,statement:string,page:number){
 const result=reconciliationHistorySchema.parse(await rpc('list_finance_reconciliation_history',{_tenant_id:tenant,_import_id:statement,_page:page}));
 if(result.tenant_id!==tenant||result.import_id!==statement||result.page!==page||result.rows.some(row=>row.tenant_id!==tenant))throw new Error('Histórico de conciliação fora do contexto.');return result;
}
export async function reverseBankReconciliation(command:ReconciliationReversalCommand){
 const result=reconciliationReversalResultSchema.parse(await rpc('reverse_finance_bank_reconciliation',{_payload:command}));
 if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id||result.group_id!==command.group_id)throw new Error('Reversão fora do contexto.');return result;
}
export async function readReconciliationContext(tenant:string,movements:string[],entries:string[]){
 const result=reconciliationContextSchema.parse(await rpc('get_finance_reconciliation_context',{_tenant_id:tenant,_movement_ids:movements,_bank_entry_ids:entries}));
 if(result.tenant_id!==tenant||result.movements.length!==movements.length||result.entries.length!==entries.length||new Set(result.movements.map(row=>row.id)).size!==movements.length||new Set(result.entries.map(row=>row.id)).size!==entries.length
  ||result.movements.some(row=>row.tenant_id!==tenant||!movements.includes(row.id))||result.entries.some(row=>row.tenant_id!==tenant||!entries.includes(row.id)))throw new Error('Conferência fora do contexto.');return result;
}
export async function reconcileBankGroup(command:ReconciliationCommand){
 const result=reconciliationResultSchema.parse(await rpc('reconcile_finance_bank_group',{_payload:command}));
 if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id)throw new Error('Confirmação da conciliação fora do contexto.');return result;
}
export async function readFiscalQueue(tenant:string,status:FiscalQueueStatus,page:number){
 const result=fiscalQueueSchema.parse(await rpc('list_finance_fiscal_queue',{_tenant_id:tenant,_status:status,_page:page}));
 if(result.tenant_id!==tenant||result.page!==page||result.status_filter!==status||result.rows.some(row=>row.tenant_id!==tenant))throw new Error('Fila fiscal fora do contexto.');
 return result;
}
export async function readPayableMovements(tenant:string,payable:string,search:string,page:number){
 const result=payableMovementOptionsSchema.parse(await rpc('get_finance_payable_movements',{_tenant_id:tenant,_payable_id:payable,_search:search,_page:page}));
 if(result.tenant_id!==tenant||result.payable_id!==payable||result.page!==page)throw new Error('Saídas fora do contexto.');return result;
}
export async function applyPayableMovement(command:PayableMovementCommand){
 const result=payableMovementResultSchema.parse(await rpc('apply_finance_payable_movement',{_payload:command}));
 if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id||result.payable_id!==command.payable_id||result.movement_id!==command.movement_id||BigInt(result.amount_cents)!==BigInt(command.amount_cents))throw new Error('Resposta da baixa fora do contexto.');return result;
}
export async function reversePayableLink(command:PayableReversalCommand){
 const result=payableReversalResultSchema.parse(await rpc('reverse_finance_payable_link',{_payload:command}));
 if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id||result.link_id!==command.link_id)throw new Error('Resposta da correção fora do contexto.');return result;
}
export async function readPayablePaymentHistory(tenant:string,payable:string,page:number){
 const result=payablePaymentHistorySchema.parse(await rpc('get_finance_payable_payment_history',{_tenant_id:tenant,_payable_id:payable,_page:page}));
 if(result.tenant_id!==tenant||result.payable_id!==payable||result.page!==page||result.rows.some(row=>row.tenant_id!==tenant||row.payable_id!==payable))throw new Error('Histórico fora do contexto.');return result;
}
export async function readPayrollProjection(tenant:string,period:string){
  const result=payrollProjectionSchema.parse(await rpc('get_finance_payroll_entries',{_tenant_id:tenant,_period_id:period}));
  if(result.tenant_id!==tenant||result.period_id!==period||result.rows.some(row=>row.tenant_id!==tenant||row.payroll_period_id!==period))throw new Error('Folha fora do contexto.');
  return result.rows;
}
export async function readPayrollPeriods(tenant:string,period?:string){
  const result=payrollPeriodsProjectionSchema.parse(await rpc('get_finance_payroll_periods',{_tenant_id:tenant,_period_id:period??null}));
  if(result.tenant_id!==tenant||result.rows.some(row=>row.tenant_id!==tenant||(period&&row.id!==period)))throw new Error('Período fora do contexto.');
  return result.rows;
}
export async function readFinanceAudit(tenant:string,filters:FinanceAuditFilters){
  const result=financeAuditSchema.parse(await rpc('list_finance_audit_events',{_tenant_id:tenant,_filters:filters}));
  if(result.tenant_id!==tenant||result.page!==filters.page||result.page_size!==filters.page_size||result.rows.some(row=>row.tenant_id!==tenant))throw new Error('Auditoria fora do contexto.');return result;
}
export async function readFinanceMovements(tenant: string, filters: MovementFilters) {
  const page = movementListSchema.parse(await rpc('list_finance_movements', { _tenant_id: tenant, _filters: filters }));
  if (page.tenant_id !== tenant || page.page !== filters.page || page.page_size !== filters.page_size || page.rows.some(row => row.tenant_id !== tenant)) {
    throw new Error('Finance response scope mismatch');
  }
  return page;
}
export async function recordFinanceMovement(command: MovementCommand) {
  const result = movementResultSchema.parse(await rpc('record_finance_movement', { _payload: command }));
  if (result.tenant_id !== command.tenant_id || result.request_id !== command.request_id) throw new Error('Finance command response mismatch');
  return result;
}
export async function readExpenseOptions(tenant: string, kind: ExpenseOptionKind, search: string, trip: string | null, page: number) {
  const result = expenseOptionsSchema.parse(await rpc('get_finance_expense_options', {
    _tenant_id: tenant, _kind: kind, _search: search, _trip_id: trip, _page: page,
  }));
  if (result.tenant_id !== tenant || result.kind !== kind || result.trip_id !== trip || result.page !== page) throw new Error('Finance options scope mismatch');
  return result;
}
export async function recordExpenseBatch(command: ExpenseBatchCommand) {
  const result = expenseBatchResultSchema.parse(await rpc('record_finance_expense_batch', {_payload: command}));
  const ids = new Set(result.rows.map(row => row.expense_id));
  if (result.tenant_id !== command.tenant_id || result.request_id !== command.request_id || ids.size !== command.items.length
    || result.rows.length !== command.items.length || command.items.some(item => !ids.has(item.id))) throw new Error('Finance batch response mismatch');
  return result;
}
export async function readExpenseHistory(tenant:string,filters:ExpenseFilters) {
  const result=expenseHistorySchema.parse(await rpc('list_finance_expenses',{_tenant_id:tenant,_filters:filters}));
  if(result.tenant_id!==tenant||result.page!==filters.page||result.page_size!==filters.page_size||result.rows.some(row=>row.tenant_id!==tenant))throw new Error('Finance history scope mismatch');
  return result;
}
export async function intakeFinanceStatement(command:StatementImportCommand){return rpc('intake_finance_statement',{_payload:command});}
export async function reviewFinanceStatementIdentity(command:StatementReviewCommand){
  const result=statementReviewResultSchema.parse(await rpc('review_finance_statement_identity',{_payload:command}));
  if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id||result.row_id!==command.row_id||result.decision!==command.decision
    ||(command.bank_entry_id!==null&&result.bank_entry_id!==command.bank_entry_id))throw new Error('Resposta de revisão fora do contexto.');return result;
}
export async function reverseFinanceIdentityReview(command:ReviewReversalCommand){
  const result=reviewReversalResultSchema.parse(await rpc('reverse_finance_identity_review',{_payload:command}));
  if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id||result.review_id!==command.review_id)throw new Error('Resposta de reversão fora do contexto.');return result;
}
export async function readFinanceIdentityCandidates(tenant:string,rowId:string,page:number){
  const result=identityCandidatesSchema.parse(await rpc('list_finance_identity_candidates',{_tenant_id:tenant,_row_id:rowId,_page:page}));
  if(result.tenant_id!==tenant||result.row_id!==rowId||result.page!==page)throw new Error('Candidatos fora do contexto.');return result;
}
export async function financeStatementOriginalReady(command:StatementImportCommand){
  const result=await rpc('finance_statement_original_ready',{_tenant_id:command.tenant_id,_file_hash:command.file_hash,_source_path:command.source_path});
  if(typeof result!=='boolean')throw new Error('Resposta de consulta do original inválida.');return result;
}
export async function readFinanceStatements(tenant:string,filters:StatementListFilters){
  const result=statementListSchema.parse(await rpc('list_finance_statements',{_tenant_id:tenant,_filters:filters}));
  if(result.tenant_id!==tenant||result.page!==filters.page||result.page_size!==filters.page_size||result.rows.some(row=>row.tenant_id!==tenant))throw new Error('Resposta de extratos fora do contexto.');return result;
}
export async function readFinanceStatementLines(tenant:string,importId:string,filters:StatementLineFilters){
  const result=statementLinesSchema.parse(await rpc('list_finance_statement_lines',{_tenant_id:tenant,_import_id:importId,_filters:filters}));
  if(result.tenant_id!==tenant||result.import_id!==importId||result.page!==filters.page||result.page_size!==filters.page_size
    ||result.rows.some(row=>row.tenant_id!==tenant||row.import_id!==importId))throw new Error('Resposta de linhas fora do contexto.');return result;
}
