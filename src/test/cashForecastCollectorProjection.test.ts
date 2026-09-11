import {expect,it} from 'vitest';
import {projectCollectedCashForecast} from '@/lib/financial/cashForecastCollectorProjection';
import type {CashForecastCollector} from '@/lib/financial/cashForecastCollectorContract';
const id=()=>crypto.randomUUID(),rev='a'.repeat(32);
function setup(){const account=id();const c:CashForecastCollector={version:1,tenant_id:id(),actor_id:id(),captured_at:'2026-09-11T12:00:00Z',revision:rev,basis:'current_company_cash_forecast',cutoff:'2026-09-10',period_end:'2026-09-30',account_scope:{mode:'whole_company',account_ids:[account]},base:{as_of:'2026-09-10',amount_cents:'100000',confirmation:'bank_confirmed',components:[{account_id:account,account_kind:'bank',source_table:'finance_account_openings',source_id:id(),source_revision:rev,amount_cents:'100000',confirmation:'bank_confirmed'}]},origins:[{economic_key:'title',source_table:'receivables',source_id:id(),source_revision:rev,direction:'in',scenario:'confirmed',nominal_cents:'10000',fulfilled_cents:'6000',reserved_credit_cents:'0',expected_on:'2026-09-20',expected_date_source:'due_date',valid:true}],recorded_after_cutoff:[{movement_id:id(),account_id:account,source_revision:rev,occurred_on:'2026-09-11',direction:'in',amount_cents:'6000',confirmation:'recorded'}],unassigned_credit_cents:'0',credits:[],source_issues:[],counts:{accounts:1,origins:1,movements:1,credits:0}};return c;}
it('connects actual recorded cash to the remaining obligation without duplicating a partial receipt',()=>{
 const c=setup();const result=projectCollectedCashForecast(c,c);expect(result.projection?.confirmed.closing_cents).toBe('110000');expect(result.projection?.scheduled.confirmed_in_cents).toBe('4000');expect(result.collection.revision).toBe(rev);
});
it('keeps invalid unbilled evidence visible while confirmed titles remain independently calculable',()=>{
 const c=setup();c.origins.push({...c.origins[0],economic_key:'freight',source_id:id(),source_table:'fiscal_documents',scenario:'unbilled',nominal_cents:null,fulfilled_cents:null,reserved_credit_cents:null,valid:false});c.counts.origins++;
 const result=projectCollectedCashForecast(c,c);expect(result.collection.origins).toHaveLength(2);expect(result.projection?.rows).toHaveLength(1);expect(result.projection?.confirmed.complete).toBe(true);expect(result.projection?.expanded.complete).toBe(false);
});
it('blocks the confirmed projection when an invalid obligation is missing a server diagnostic',()=>{
 const c=setup();Object.assign(c.origins[0],{valid:false,nominal_cents:null,fulfilled_cents:null,reserved_credit_cents:null});const r=projectCollectedCashForecast(c,c);expect(r.projection?.confirmed.closing_cents).toBeNull();expect(r.issues).toContainEqual({scope:'confirmed',code:'forecast_origin_unverified',source_ids:[c.origins[0].source_id]});
});
it('preserves unknown credits and never substitutes zero or guesses a title allocation',()=>{
 const c=setup();c.credits=[{credit_id:id(),payer_id:id(),source_payment_id:id(),source_revision:rev,amount_cents:null,valid:false}];c.counts.credits=1;c.unassigned_credit_cents=null;const r=projectCollectedCashForecast(c,c);expect(r.projection?.unassigned_credit_cents).toBeNull();expect(r.projection?.confirmed.complete).toBe(false);expect(r.projection?.rows[0].reserved_credit_cents).toBe('0');
});
it('returns explicit unavailability for a company with no account instead of fabricating a balance',()=>{
 const c=setup();c.account_scope.account_ids=[];c.base={as_of:c.cutoff,amount_cents:null,confirmation:'unverified',components:[]};c.recorded_after_cutoff=[];c.counts.accounts=0;c.counts.movements=0;const r=projectCollectedCashForecast(c,c);expect(r.projection).toBeNull();expect(r.issues.some(i=>i.code==='forecast_accounts_unavailable')).toBe(true);
});
it('rejects wrong actor, company, dates, revision and incomplete counts',()=>{
 const c=setup();for(const changed of [{actor_id:id()},{tenant_id:id()},{cutoff:'2026-09-09'},{period_end:'2026-10-01'},{revision:'b'.repeat(32)}])expect(()=>projectCollectedCashForecast(c,{...c,...changed})).toThrow('Coleta diferente');c.counts.origins=2;expect(()=>projectCollectedCashForecast(c,c)).toThrow('Counts');
});
