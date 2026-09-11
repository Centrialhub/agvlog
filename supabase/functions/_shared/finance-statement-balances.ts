import {statementCents,type StatementMapping,type StatementSourceRow} from './finance-statement-reader.ts';
export interface StatementBalanceCheck{
  status:'not_configured'|'insufficient_evidence'|'inconsistent'|'consistent';
  checked_transitions:number;covered_transactions:number;balance_samples:number;discrepancy_count:number;
  discrepancies:Array<{source_row:number;expected_cents:string;actual_cents:string}>;
  order_consistent:boolean|null;account_coverage_verification:'pending';
}
// Checks arithmetic between reported balance anchors. It cannot certify that
// the file covers the entire bank period or belongs to the chosen account.
export function checkStatementBalances(rows:StatementSourceRow[],map:StatementMapping):StatementBalanceCheck{
  const result:StatementBalanceCheck={status:'not_configured',checked_transitions:0,covered_transactions:0,balance_samples:0,discrepancy_count:0,discrepancies:[],order_consistent:null,account_coverage_verification:'pending'};
  if(map.balance_column===undefined||!['before_transaction','after_transaction'].includes(map.balance_basis||'')||!['chronological','reverse_chronological'].includes(map.row_order||''))return result;
  const ordered=map.row_order==='reverse_chronological'?[...rows].reverse():rows;
  result.order_consistent=ordered.every((row,index)=>index===0||ordered[index-1].posted_on<=row.posted_on);
  if(!result.order_consistent){result.status='inconsistent';return result;}
  let accumulated=0n,lastAnchor:{balance:bigint;accumulated:bigint;index:number}|null=null;
  for(let index=0;index<ordered.length;index++){
    const row=ordered[index],amount=BigInt(row.amount_cents);
    if(map.balance_basis==='after_transaction')accumulated+=amount;
    const value=row.raw.cells[map.balance_column];
    if(value!==null&&value!==undefined&&String(value).trim()!==''){
      const balance=BigInt(statementCents(value,map.number_format));result.balance_samples++;
      if(lastAnchor){const expected:bigint=lastAnchor.balance+accumulated-lastAnchor.accumulated;result.checked_transitions++;result.covered_transactions+=index-lastAnchor.index;
        if(expected!==balance){result.discrepancy_count++;if(result.discrepancies.length<100)result.discrepancies.push({source_row:row.raw.source_row,expected_cents:expected.toString(),actual_cents:balance.toString()});}}
      lastAnchor={balance,accumulated,index};
    }
    if(map.balance_basis==='before_transaction')accumulated+=amount;
  }
  result.status=result.discrepancy_count?'inconsistent':result.checked_transitions?'consistent':'insufficient_evidence';return result;
}
