import { describe, expect, it } from 'vitest';
import { projectCashForecast, type CashForecastBasis } from '@/lib/financial/cashForecastProjection';
const id = () => crypto.randomUUID();
function basis(): CashForecastBasis {
  return { version:1,tenant_id:id(),account_ids:[id()],captured_at:'2026-09-11T12:00:00Z',cutoff:'2026-09-10',period_end:'2026-09-30',
    base:{amount_cents:'100000',as_of:'2026-09-10',source_id:id(),source_revision:'original-bank-snapshot',confirmation:'bank_confirmed'},
    origins:[],recorded_after_cutoff:[],unassigned_credit_cents:'0',source_issues:[] };
}
function row(overrides: Partial<CashForecastBasis['origins'][number]> = {}): CashForecastBasis['origins'][number] {
  return {economic_key:id(),source_table:'receivables',source_id:id(),source_revision:'source-v1',direction:'in',scenario:'confirmed',nominal_cents:'100000',fulfilled_cents:'60000',reserved_credit_cents:'10000',expected_on:'2026-09-20',expected_date_source:'due_date',...overrides};
}
describe('cash forecast projection basis',()=>{
 it('counts only future cash still needed and separates unbilled freight',()=>{
  const input=basis();input.origins=[row(),row({source_table:'payables',direction:'out',nominal_cents:'50000',fulfilled_cents:'20000',reserved_credit_cents:'0'}),row({source_table:'fiscal_documents',scenario:'unbilled',nominal_cents:'20000',fulfilled_cents:'0',reserved_credit_cents:'0'})];
  const result=projectCashForecast(input);
  expect(result.scheduled).toEqual({confirmed_in_cents:'30000',confirmed_out_cents:'30000',unbilled_in_cents:'20000'});
  expect(result.confirmed.closing_cents).toBe('100000');expect(result.expanded.closing_cents).toBe('120000');
 });
 it('does not count a paid title or an advance applied later as new cash',()=>{
  const input=basis();input.origins=[row({fulfilled_cents:'100000',reserved_credit_cents:'0'}),row({fulfilled_cents:'0',reserved_credit_cents:'100000'})];
  const result=projectCashForecast(input);expect(result.rows.every(item=>item.timing==='already_covered')).toBe(true);expect(result.scheduled.confirmed_in_cents).toBe('0');
 });
 it('requires new dates for overdue or undated balances instead of forecasting from past maturity',()=>{
  const input=basis();input.origins=[row({expected_on:'2026-09-10'}),row({expected_on:null,expected_date_source:'unknown'})];
  const result=projectCashForecast(input);expect(result.unscheduled.confirmed_cents).toBe('60000');expect(result.confirmed.closing_cents).toBeNull();
 });
 it('allows an explicitly reviewed future date and excludes balances beyond the period',()=>{
  const input=basis();input.origins=[row({expected_on:'2026-09-15',expected_date_source:'reviewed_date'}),row({expected_on:'2026-10-01'})];
  const result=projectCashForecast(input);expect(result.scheduled.confirmed_in_cents).toBe('30000');expect(result.rows[1].timing).toBe('after_period');
 });
 it('does not invent which obligation an unassigned customer credit will cover',()=>{
  const input=basis();input.origins=[row()];input.unassigned_credit_cents='15000';
  const result=projectCashForecast(input);expect(result.scheduled.confirmed_in_cents).toBe('30000');expect(result.confirmed.closing_cents).toBeNull();expect(result.issues[0].code).toBe('unassigned_customer_credit');
 });
 it('keeps undated unbilled freight out of the confirmed scenario without presenting expanded totals as complete',()=>{
  const input=basis();input.origins=[row({scenario:'unbilled',expected_on:null,expected_date_source:'unknown'})];
  const result=projectCashForecast(input);expect(result.confirmed.complete).toBe(true);expect(result.expanded.complete).toBe(false);
 });
 it('preserves the original projection when later source data changes',()=>{
  const input=basis();input.origins=[row()];const original=projectCashForecast(input);const serialized=JSON.stringify(original);
  input.origins[0].nominal_cents='200000';input.base.amount_cents='500000';
  expect(JSON.stringify(original)).toBe(serialized);expect(projectCashForecast(input).confirmed.closing_cents).not.toBe(original.confirmed.closing_cents);
 });
 it('rejects duplicate economic origins even when fiscal and billing IDs differ',()=>{
  const input=basis();input.origins=[row({economic_key:'freight-once'}),row({economic_key:'freight-once',source_table:'client_invoices'})];
  expect(()=>projectCashForecast(input)).toThrow('mesma origem econômica');
 });
 it('rejects malformed dates and credit over-allocation rather than clamping the balance',()=>{
  const input=basis();input.origins=[row({expected_on:'2026-02-30'})];expect(()=>projectCashForecast(input)).toThrow();
  input.origins=[row({reserved_credit_cents:'50000'})];expect(()=>projectCashForecast(input)).toThrow('excedem');
 });
 it('keeps an unknown base unknown and provisional provenance visible',()=>{
  const input=basis();input.base.amount_cents=null;input.base.confirmation='unverified';expect(projectCashForecast(input).confirmed.closing_cents).toBeNull();
  input.base.amount_cents='100000';input.base.confirmation='provisional';expect(projectCashForecast(input).base.confirmation).toBe('provisional');
 });
});

it('bridges cash recorded after the opening cutoff without predicting that paid share again',()=>{
 const input=basis();input.origins=[row({fulfilled_cents:'60000',reserved_credit_cents:'0'})];
 input.recorded_after_cutoff=[{movement_id:id(),account_id:input.account_ids[0],source_revision:'receipt-original',occurred_on:'2026-09-11',direction:'in',amount_cents:'60000',confirmation:'recorded'}];
 const result=projectCashForecast(input);expect(result.recorded_totals.in_cents).toBe('60000');expect(result.scheduled.confirmed_in_cents).toBe('40000');expect(result.confirmed.closing_cents).toBe('200000');
 input.recorded_after_cutoff.push({...input.recorded_after_cutoff[0]});expect(()=>projectCashForecast(input)).toThrow('Movimento repetido');
});

it('treats a due date after an old base but before capture as overdue, not future cash',()=>{
 const input=basis();input.cutoff='2026-09-01';input.base.as_of=input.cutoff;input.origins=[row({expected_on:'2026-09-05'})];
 const result=projectCashForecast(input);expect(result.rows[0].timing).toBe('needs_new_date');expect(result.confirmed.closing_cents).toBeNull();
});


it('isolates an unbilled evidence problem from proven confirmed obligations',()=>{
 const input=basis();input.origins=[row()];const source=id();
 input.source_issues=[{code:'unbilled_price_unverified',source_ids:[source],scope:'expanded'}];
 const result=projectCashForecast(input);
 expect(result.confirmed).toEqual({complete:true,closing_cents:'130000'});
 expect(result.expanded).toEqual({complete:false,closing_cents:null});
 expect(result.issues).toEqual([{code:'unbilled_price_unverified',source_ids:[source],scope:'expanded'}]);
 expect(input.source_issues).toHaveLength(1);
});

it.each(['confirmed','all',undefined] as const)('keeps confirmed issues and legacy unscoped issues blocking both scenarios: %s',scope=>{
 const input=basis();input.source_issues=[{code:'title_balance_unverified',source_ids:[id()],...(scope?{scope}:{})}];
 const result=projectCashForecast(input);
 expect(result.confirmed).toEqual({complete:false,closing_cents:null});
 expect(result.expanded).toEqual({complete:false,closing_cents:null});
});

it('does not let an expanded-only issue hide an unknown opening or unassigned customer credit',()=>{
 const input=basis();input.source_issues=[{code:'unbilled_price_unverified',source_ids:[id()],scope:'expanded'}];
 input.unassigned_credit_cents='1000';expect(projectCashForecast(input).confirmed.complete).toBe(false);
 input.unassigned_credit_cents='0';input.base.amount_cents=null;input.base.confirmation='unverified';
 expect(projectCashForecast(input).confirmed.closing_cents).toBeNull();
});
