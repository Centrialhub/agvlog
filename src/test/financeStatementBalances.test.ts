import {describe,expect,it} from 'vitest';
import {checkStatementBalances} from '../../supabase/functions/_shared/finance-statement-balances';
import {mapStatementMatrix,type StatementMapping} from '../../supabase/functions/_shared/finance-statement-reader';
const map:StatementMapping={header_row:0,date_column:0,description_column:1,amount_column:2,balance_column:3,number_format:'decimal',date_format:'ymd',balance_basis:'after_transaction',row_order:'chronological'};
function check(values:unknown[][],mapping=map){return checkStatementBalances(mapStatementMatrix([['Date','Description','Amount','Balance'],...values],mapping,{start:'2026-01-01',end:'2026-01-31'}).rows,mapping);}
const rows=[['2026-01-01','PIX',-50,950],['2026-01-02','PIX',-20,930],['2026-01-03','Recebimento',100,1030]];
describe('statement balance arithmetic is a separate check from bank coverage',()=>{
  it('checks exact cents after transactions without claiming initial/final coverage',()=>{
    expect(check(rows)).toMatchObject({status:'consistent',checked_transitions:2,covered_transactions:2,account_coverage_verification:'pending'});
  });
  it('supports explicitly reversed source order and before-transaction balances',()=>{
    expect(check([...rows].reverse(),{...map,row_order:'reverse_chronological'}).status).toBe('consistent');
    expect(check([['2026-01-01','PIX',-50,1000],['2026-01-02','PIX',-20,950],['2026-01-03','Recebimento',100,930]],{...map,balance_basis:'before_transaction'}).status).toBe('consistent');
  });
  it('covers intervening rows with missing balances instead of skipping their money',()=>{
    expect(check([rows[0],['2026-01-02','PIX',-20,null],rows[2]])).toMatchObject({status:'consistent',checked_transitions:1,covered_transactions:2});
    expect(check([rows[0],['2026-01-02','PIX',-19,null],rows[2]])).toMatchObject({status:'inconsistent',discrepancies:[{source_row:4,expected_cents:'103100',actual_cents:'103000'}]});
  });
  it('does not infer semantics or certify a single balance',()=>{
    expect(check(rows,{...map,balance_basis:undefined}).status).toBe('not_configured');expect(check([rows[0]]).status).toBe('insufficient_evidence');
  });
  it('flags incorrect date ordering, repeated daily balances and sign discrepancies',()=>{
    expect(check([...rows].reverse())).toMatchObject({status:'inconsistent',order_consistent:false});
    expect(check([rows[0],['2026-01-01','PIX',-20,950]])).toMatchObject({status:'inconsistent',discrepancy_count:1});
    expect(check([rows[0],['2026-01-02','PIX',20,930]])).toMatchObject({status:'inconsistent',discrepancy_count:1});
  });
  it('rejects using the transaction amount column as independent balance evidence',()=>{
    expect(()=>check(rows,{...map,balance_column:2})).toThrow('overlapping_columns');
  });
});
