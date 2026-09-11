// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {projectCollectedCashForecast} from '@/lib/financial/cashForecastCollectorProjection';
const id=()=>crypto.randomUUID(),revision='a'.repeat(32);
it('matches SQL and TS noncash projection, invalid evidence rejection and legacy inputs',async()=>{
 const db=new PGlite();try{
 await db.exec('create schema finance_private;create role anon;create role authenticated;create role service_role;');
 const base=readFileSync('supabase/migrations/20260911084618_finance_cash_forecast_pure_projection.sql','utf8');await db.exec(base.slice(base.indexOf('create function finance_private.validate_forecast_json'),base.indexOf('create function finance_private.project_collected_cash_forecast')));
 const agenda=readFileSync('supabase/migrations/20260911094505_finance_cash_forecast_audited_agenda.sql','utf8');const start=agenda.indexOf('create function finance_private.forecast_agenda_projection_input');await db.exec(agenda.slice(start,agenda.indexOf('end$$;',start)+7));
 const candidate=readFileSync('supabase/migrations/20260911115916_finance_cash_forecast_balance_adjustments.sql','utf8');
 for(const name of ['forecast_adjustment_amount','forecast_adjustment_validation_input']){const at=candidate.indexOf('create function finance_private.'+name);await db.exec(candidate.slice(at,candidate.indexOf('end$$;',at)+7));}
 const at=candidate.indexOf('CREATE OR REPLACE FUNCTION finance_private.project_collected_cash_forecast(');await db.exec(candidate.slice(at));
 const account=id(),source=id();const collection={version:1,tenant_id:id(),actor_id:id(),captured_at:'2026-09-11T12:00:00Z',revision,basis:'current_company_cash_forecast',cutoff:'2026-09-10',period_end:'2026-09-30',account_scope:{mode:'whole_company',account_ids:[account]},base:{as_of:'2026-09-10',amount_cents:'0',confirmation:'bank_confirmed',components:[{account_id:account,account_kind:'bank',source_table:'finance_account_openings',source_id:id(),source_revision:revision,amount_cents:'0',confirmation:'bank_confirmed'}]},origins:[{economic_key:'receivable:'+source,source_table:'receivables',source_id:source,source_revision:revision,direction:'in',scenario:'confirmed',nominal_cents:'100000',fulfilled_cents:'90000',reserved_credit_cents:'0',discount_cents:'10000',loss_cents:'0',adjustment_cents:'10000',expected_on:null,expected_date_source:'unknown',valid:true}],recorded_after_cutoff:[{movement_id:id(),account_id:account,source_revision:revision,occurred_on:'2026-09-11',direction:'in',amount_cents:'90000',confirmation:'recorded'}],unassigned_credit_cents:'0',credits:[],source_issues:[],counts:{accounts:1,origins:1,movements:1,credits:0}};
 const sql=async(v:unknown)=>(await db.query<{v:unknown}>('select finance_private.project_collected_cash_forecast($1) v',[v])).rows[0].v;
 const compare=async(v:typeof collection)=>expect(await sql(v)).toEqual(projectCollectedCashForecast(v,v));
 const loss=structuredClone(collection);loss.recorded_after_cutoff=[];loss.counts.movements=0;Object.assign(loss.origins[0],{fulfilled_cents:'0',reserved_credit_cents:'30000',discount_cents:'0',loss_cents:'70000',adjustment_cents:'70000'});await compare(loss);expect(projectCollectedCashForecast(loss,loss).projection!.confirmed.closing_cents).toBe('0');
 await compare(collection);const first=await sql(collection);collection.origins[0].discount_cents='5000';collection.origins[0].adjustment_cents='5000';await compare(collection);expect(await sql(collection)).not.toEqual(first);
 const legacy=structuredClone(collection);for(const key of ['discount_cents','loss_cents','adjustment_cents'])delete (legacy.origins[0] as unknown as Record<string,unknown>)[key];await compare(legacy);
 for(const change of [{discount_cents:undefined},{loss_cents:null},{adjustment_cents:'9999'},{discount_cents:'20000',adjustment_cents:'20000'}]){const bad=structuredClone(collection);Object.assign(bad.origins[0],change);await expect(sql(bad)).rejects.toMatchObject({code:'22023'});expect(()=>projectCollectedCashForecast(bad,bad)).toThrow();}
 const invalid=structuredClone(collection);Object.assign(invalid.origins[0],{valid:false,nominal_cents:null,fulfilled_cents:null,reserved_credit_cents:null,discount_cents:null,loss_cents:null,adjustment_cents:null});await compare(invalid);
 }finally{await db.close();}
},30000);
