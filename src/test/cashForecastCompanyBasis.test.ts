import {expect,it} from 'vitest';
import {projectCashForecast,type CashForecastCompanyBasis} from '@/lib/financial/cashForecastProjection';
const id=()=>crypto.randomUUID();
function input():CashForecastCompanyBasis{
 const bank=id(),cash=id();return {version:2,tenant_id:id(),account_ids:[bank,cash],captured_at:'2026-09-11T12:00:00Z',cutoff:'2026-09-10',period_end:'2026-09-30',base:{as_of:'2026-09-10',amount_cents:'12500',confirmation:'mixed_confirmed',components:[{account_id:bank,account_kind:'bank',source_table:'finance_account_period_closures',source_id:id(),source_revision:'bank-proof',amount_cents:'10000',confirmation:'bank_confirmed'},{account_id:cash,account_kind:'cash',source_table:'finance_account_period_closures',source_id:id(),source_revision:'count-proof',amount_cents:'2500',confirmation:'cash_count'}]},origins:[],recorded_after_cutoff:[],unassigned_credit_cents:'0',source_issues:[]};
}
it('preserves separate bank and cash proofs behind the consolidated base',()=>{
 const source=input();const result=projectCashForecast(source);
 expect(result.version).toBe(2);expect(result.confirmed.closing_cents).toBe('12500');expect(result.base).toEqual(source.base);
 source.base.components[0].amount_cents='90000';expect(result.base.amount_cents).toBe('12500');
 expect('components' in result.base&&result.base.components[0].amount_cents).toBe('10000');
});
it('rejects omitted, duplicate and foreign account components',()=>{
 for(const mutate of [(v:CashForecastCompanyBasis)=>v.base.components.pop(),(v:CashForecastCompanyBasis)=>{v.base.components[1].account_id=v.account_ids[0];},(v:CashForecastCompanyBasis)=>{v.base.components[0].account_id=id();}]){const v=input();mutate(v);expect(()=>projectCashForecast(v)).toThrow('cada conta');}
});
it('rejects incorrect sums and upgrades of provisional proof',()=>{
 const v=input();v.base.amount_cents='12501';expect(()=>projectCashForecast(v)).toThrow('soma');
 v.base.amount_cents='12500';v.base.components[0].confirmation='provisional';expect(()=>projectCashForecast(v)).toThrow('Confirmação consolidada');
 v.base.confirmation='provisional';expect(projectCashForecast(v).base.confirmation).toBe('provisional');
});
it('does not turn an account without evidence into zero cash or a fabricated source ID',()=>{
 const v=input();const p=v.base.components[1];p.amount_cents=null;p.confirmation='unverified';p.source_id=null;p.source_table=null;v.base.amount_cents=null;v.base.confirmation='unverified';
 const result=projectCashForecast(v);expect(result.confirmed.closing_cents).toBeNull();expect('components' in result.base&&result.base.components[1].source_id).toBeNull();
 v.base.amount_cents='10000';expect(()=>projectCashForecast(v)).toThrow();
});
it('requires real provenance and account-compatible confirmation for a determined balance',()=>{
 const v=input();v.base.components[0].source_id=null;expect(()=>projectCashForecast(v)).toThrow('origem preservada');
 v.base.components[0].source_id=id();v.base.components[0].confirmation='cash_count';v.base.confirmation='cash_count';expect(()=>projectCashForecast(v)).toThrow('tipo de conta');
});


it('preserves unsupported account kinds as unknown instead of pretending they are bank accounts',()=>{
 const v=input();v.base.components[0].account_kind='unsupported';expect(()=>projectCashForecast(v)).toThrow('Tipo de conta desconhecido');
 v.base.components[0].confirmation='unverified';v.base.components[0].amount_cents=null;v.base.amount_cents=null;v.base.confirmation='unverified';
 const projected=projectCashForecast(v);expect(projected.confirmed.complete).toBe(false);
 expect('components' in projected.base&&projected.base.components[0].account_kind).toBe('unsupported');
});
