import type {ExpenseHistoryRow} from './expenseHistoryContract';
import {formatFinanceCents} from './ledgerContract';
type CostRow=Pick<ExpenseHistoryRow,'id'|'tenant_id'|'amount_cents'|'allocated_cents'|'unloading_id'|'payable_id'|'cost_origin'|'effective_amount_cents'|'coverage'|'complement_cents'>;
export function expenseCurrentCost(row:CostRow):string|null{
  // Old readers predate cost amendments. Only a response without either new field uses that contract.
  if(row.cost_origin===undefined&&row.effective_amount_cents===undefined)return String(row.amount_cents);
  const cost=row.cost_origin;
  if(!cost?.verified||cost.issue!==null||cost.tenant_id!==row.tenant_id||cost.expense_id!==row.id||cost.charge_id!==row.unloading_id||cost.payable_id!==row.payable_id||cost.original_amount_cents!==String(row.amount_cents)||cost.effective_amount_cents!==row.effective_amount_cents)return null;
  return cost.effective_amount_cents;
}
export function expenseCurrentComplement(row:CostRow):string|null{
  const amount=expenseCurrentCost(row);
  if(amount===null)return null;
  if(row.coverage!==undefined){const coverage=row.coverage;return coverage.verified&&coverage.issue===null&&row.complement_cents===coverage.complement_cents?row.complement_cents??null:null;}
  const difference=BigInt(amount)-BigInt(row.allocated_cents);
  return difference<0n?null:String(difference);
}
export const expenseCostMoney=(value:string|null)=>value===null?'A conferir':formatFinanceCents(value);
