// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,expect,it} from 'vitest';
import {createCashForecastCollectorDatabase} from './helpers/cashForecastCollectorDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {cashForecastSourcesSchema} from '@/lib/financial/cashForecastViewContract';
let db:Awaited<ReturnType<typeof createCashForecastCollectorDatabase>>;
const read=(n:string)=>readFileSync('supabase/migrations/'+n+'.sql','utf8');
beforeAll(async()=>{db=await createCashForecastCollectorDatabase();for(const n of ['20260911084618_finance_cash_forecast_pure_projection','20260911084626_finance_cash_forecast_preserved_snapshots','20260911085621_finance_cash_forecast_public_readers','20260911090256_finance_cash_forecast_public_boundary','20260911092902_finance_cash_forecast_source_identification'])await db.exec(read(n));},30000);
afterAll(async()=>db?.close());
it('labels current identities while preserving original amounts, revision and snapshot hash',async()=>{
 await db.exec('begin');try{
 const client=randomUUID(),title=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Fornecedor original',true)",[client,i.tenant]);
 await db.query("insert into receivables(id,tenant_id,client_id,amount,received_amount,status,due_date,description,invoice_number) values($1,$2,$3,150,0,'pending',current_date+10,'Descarga conferida','NF123')",[title,i.tenant,client]);
 const p=(await financeAs<{v:{revision:string,cutoff:string,period_end:string}}>(db,i.operator,"select preview_finance_cash_forecast($1,current_date-1,current_date+30,null) v",[i.tenant])).rows[0].v;
 const saved=(await financeAs<{v:{snapshot_id:string,content_hash:string}}>(db,i.operator,'select record_finance_cash_forecast($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),cutoff:p.cutoff,period_end:p.period_end,source_revision:p.revision,title:'Conferencia de nomes',reason:'Preservar valores originais da previsao'}])).rows[0].v;
 const page=async()=>(await financeAs<{v:{rows:Array<{source_id:string,nominal_cents:string,display:{basis:string,party_name:string,description:string,document_number:string}}>}}>(db,i.operator,"select get_finance_cash_forecast_sources($1,$2,$3,$4,'origins',1,$5) v",[i.tenant,p.cutoff,p.period_end,saved.snapshot_id,p.revision])).rows[0].v;
 cashForecastSourcesSchema.parse(await page());
 const first=(await page()).rows.find(x=>x.source_id===title)!;expect(first).toMatchObject({nominal_cents:'15000',display:{basis:'current_identification',party_name:'Fornecedor original',description:'Descarga conferida',document_number:'NF123'}});
 await db.query("update clients set company_name='Fornecedor atualizado' where id=$1",[client]);await db.query("update receivables set amount=200,description='Descricao atual' where id=$1",[title]);
 const changed=(await page()).rows.find(x=>x.source_id===title)!;expect(changed).toMatchObject({nominal_cents:'15000',display:{basis:'current_identification',party_name:'Fornecedor atualizado',description:'Descricao atual'}});
 const preserved=(await financeAs<{v:{content_hash:string,source_revision:string}}>(db,i.operator,'select get_finance_cash_forecast_snapshot($1,$2) v',[i.tenant,saved.snapshot_id])).rows[0].v;expect(preserved).toMatchObject({content_hash:saved.content_hash,source_revision:p.revision});
 expect((await db.query("select has_function_privilege('authenticated','finance_private.cash_forecast_identified_sources(uuid,jsonb)','execute') allowed")).rows).toEqual([{allowed:false}]);
 }finally{await db.exec('rollback');}
});
it('keeps current identification within the signed company even for forged private input',async()=>{
 await db.exec('begin');try{
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);
 const foreign=randomUUID();await db.query("insert into payables(id,tenant_id,supplier_name,category,description,amount,status) values($1,$2,'FOREIGN SECRET','other','private',1,'pending')",[foreign,i.otherTenant]);
 const p={tenant_id:i.tenant,actor_id:i.operator,kind:'origins',rows:[{source_id:foreign,source_table:'payables',nominal_cents:'100'}]};
 const result=(await db.query<{v:{rows:Array<{display:{party_name:null,description:null}}>}}>('select finance_private.cash_forecast_identified_sources($1,$2) v',[i.tenant,p])).rows[0].v;expect(result.rows[0].display).toMatchObject({party_name:null,description:null});
 await db.exec('savepoint denied');await expect(db.query('select finance_private.cash_forecast_identified_sources($1,$2)',[i.otherTenant,p])).rejects.toMatchObject({code:'42501'});await db.exec('rollback to denied');
 }finally{await db.exec('rollback');}
});
