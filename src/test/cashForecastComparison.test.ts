import { expect, it } from 'vitest';
import { projectCashForecast, type CashForecastBasis } from '@/lib/financial/cashForecastProjection';
import { compareCashForecast } from '@/lib/financial/cashForecastComparison';
import { moneyPackageFixture } from './helpers/periodMoneyPackageFixture';
function setup() {
 const realized=moneyPackageFixture();
 const origin=(direction:'in'|'out',amount:string)=>({economic_key:crypto.randomUUID(),source_table:direction==='in'?'receivables':'payables',source_id:crypto.randomUUID(),source_revision:'original',direction,scenario:'confirmed' as const,nominal_cents:amount,fulfilled_cents:'0',reserved_credit_cents:'0',expected_on:'2026-08-15',expected_date_source:'due_date' as const});
 const basis:CashForecastBasis={version:1,tenant_id:realized.tenant_id,account_ids:[...realized.account_scope.selected_ids],captured_at:'2026-08-01T12:00:00Z',cutoff:'2026-07-31',period_end:'2026-08-31',base:{amount_cents:'1100',as_of:'2026-07-31',source_id:crypto.randomUUID(),source_revision:'opening-original',confirmation:'provisional'},origins:[origin('in','600'),origin('out','350')],recorded_after_cutoff:[],unassigned_credit_cents:'0',source_issues:[]};
 return {realized,basis};
}
it('compares gross flows and retains the original forecast when actual cash is lower',()=>{
 const {realized,basis}=setup();const original=projectCashForecast(basis),before=JSON.stringify(original);
 const result=compareCashForecast(original,realized);
 expect(result.confirmed).toMatchObject({available:true,matches:false,differences:{opening_cents:'0',in_cents:'-100',out_cents:'0',closing_cents:'-100'}});
 expect(result.flow_basis).toBe('gross_cash');expect(result.cause_attribution).toBe('not_determined');expect(JSON.stringify(original)).toBe(before);
});
it('does not call equal closing balances a match when opening and inflows differ',()=>{
 const {realized,basis}=setup();basis.base.amount_cents='1000';
 const result=compareCashForecast(projectCashForecast(basis),realized);
 expect(result.confirmed).toMatchObject({matches:false,differences:{opening_cents:'100',in_cents:'-100',closing_cents:'0'}});
});
it('rejects cross-company, cross-account and mismatched period comparisons',()=>{
 const {realized,basis}=setup();const forecast=projectCashForecast(basis);
 expect(()=>compareCashForecast({...forecast,tenant_id:crypto.randomUUID()},realized)).toThrow('mesma empresa');
 expect(()=>compareCashForecast({...forecast,account_ids:[crypto.randomUUID()]},realized)).toThrow('mesma empresa');
 expect(()=>compareCashForecast({...forecast,period_end:'2026-09-30'},realized)).toThrow('mesma empresa');
});
it('does not fabricate a variance when the forecast is incomplete or the realized closing lacks coverage',()=>{
 const {realized,basis}=setup();basis.origins[0].expected_on='2026-07-30';
 expect(compareCashForecast(projectCashForecast(basis),realized).confirmed).toEqual({available:false,matches:false,differences:null});
 basis.origins[0].expected_on='2026-08-15';realized.monetary_totals_valid=false;realized.totals={opening_cents:null,in_cents:null,out_cents:null,closing_cents:null};realized.transfer_classification_valid=false;realized.transfer_totals={internal_pair_cents:null,in_excluding_internal_pairs_cents:null,out_excluding_internal_pairs_cents:null};
 expect(compareCashForecast(projectCashForecast(basis),realized).confirmed.available).toBe(false);
});
it('rejects a modified original total instead of recalculating it to appear consistent',()=>{
 const {realized,basis}=setup();const original=projectCashForecast(basis);original.confirmed.closing_cents='1250';
 expect(()=>compareCashForecast(original,realized)).toThrow('valores preservados');
});
