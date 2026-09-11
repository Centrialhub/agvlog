// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createUnloadingCostCorrectionDatabase} from './helpers/unloadingCostCorrectionDatabase';
import {seedOpenComplementPublicScenario} from './helpers/openComplementPublicDatabase';
import {installCashForecastCollectorSources} from './helpers/cashForecastCollectorDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {cashForecastCollectorSchema} from '@/lib/financial/cashForecastCollectorContract';
let db:Awaited<ReturnType<typeof createUnloadingCostCorrectionDatabase>>;
const read=(n:string)=>readFileSync('supabase/migrations/'+n+'.sql','utf8');
beforeAll(async()=>{db=await createUnloadingCostCorrectionDatabase();},30000);
afterAll(async()=>db?.close());
it('forecasts only the revised open complement and removes its outstanding value after a real payment',async()=>{
 await db.exec('begin');
 try{
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);
 await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 const source=await seedOpenComplementPublicScenario(db);
 for(const n of ['20260911085400_finance_payable_revision_approval','20260911083307_finance_unloading_open_complement_public_boundary','20260911090910_finance_open_complement_approval_final_preflight'])await db.exec(read(n));
 await installCashForecastCollectorSources(db);
 const dates=(await db.query<{cutoff:string,end:string}>("select (current_date-1)::text cutoff,current_date::text end")).rows[0];
 const collect=async()=>cashForecastCollectorSchema.parse((await db.query<{v:unknown}>('select finance_private.cash_forecast_collect($1,$2,$3) v',[i.tenant,dates.cutoff,dates.end])).rows[0].v);
 const first=await collect();expect(first.origins.find(x=>x.source_id===source.payable_id)).toMatchObject({valid:true,nominal_cents:'5000',fulfilled_cents:'0'});
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferir obrigacao vigente e preservar a previsao'});
 const preview=(await financeAs<{v:{revision:string}}>(db,i.operator,'select preview_finance_unloading_open_complement($1,$2,$3) v',[i.tenant,source.unloading_id,'12000'])).rows[0].v;
 await financeAs(db,i.operator,'select correct_finance_unloading_open_complement($1)',[{...base(),charge_id:source.unloading_id,expense_id:source.id,payable_id:source.payable_id,amount_cents:'12000',revision:preview.revision}]);
 const corrected=await collect();expect(corrected.revision).not.toBe(first.revision);expect(corrected.origins.find(x=>x.source_id===source.payable_id)).toMatchObject({valid:true,nominal_cents:'2000',fulfilled_cents:'0'});
 const approval=(await financeAs<{v:{revision:string}}>(db,i.operator,'select preview_finance_payable_approval($1,$2) v',[i.tenant,source.payable_id])).rows[0].v;
 await financeAs(db,i.operator,'select approve_finance_payable($1)',[{...base(),payable_id:source.payable_id,revision:approval.revision,amount_cents:'2000'}]);
 const out=(await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[{...base(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:2000,occurred_on:'2026-08-03',description:'Complemento revisado conferido',beneficiary_name:'Prestador'}])).rows[0].v;
 await financeAs(db,i.operator,'select apply_finance_payable_movement($1)',[{...base(),payable_id:source.payable_id,movement_id:out.movement_id,amount_cents:2000,method:'pix'}]);
 await db.exec('set constraints all immediate');
 expect((await collect()).origins.find(x=>x.source_id===source.payable_id)).toMatchObject({valid:true,nominal_cents:'2000',fulfilled_cents:'2000'});
 expect((await db.query('select finance_private.movement_used_cents($1,$2)::text n',[i.tenant,source.movement_id])).rows).toEqual([{n:'10000'}]);
 }finally{await db.exec('rollback');}
},30000);
