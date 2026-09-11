// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {createPeriodUnloadingFlowDatabase} from './helpers/periodUnloadingFlowDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {receivablesOriginPageSchema} from '@/lib/financial/receivablesPageContract';
let db:PGlite;
beforeAll(async()=>{db=await createPeriodUnloadingFlowDatabase();await db.exec(readFileSync('supabase/migrations/20260911045009_finance_receivables_origin_filter.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function charge(amount=15000,day='2026-01-10',supplier?:string,twoDocuments=false){
 const payer=supplier??randomUUID(),stop=randomUUID(),doc=randomUUID();if(!supplier)await db.query("insert into clients(id,tenant_id,active,company_name) values($1,$2,true,'Fornecedor preservado')",[payer,i.tenant]);
 const trip=(await db.query<{id:string}>('select id from dispatch_trips where tenant_id=$1 limit 1',[i.tenant])).rows[0].id;
 await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,client_id,status,destination) values($1,$2,$3,$4,'pending','Entrega da descarga')",[stop,i.tenant,trip,payer]);
 await db.query("insert into fiscal_documents(id,tenant_id,client_id,supplier_id,document_type,status,invoice_number,value) values($1,$2,$3,$3,'inbound','ready','NF-DESCARGA',1000)",[doc,i.tenant,payer]);
 await db.query('insert into dispatch_stop_documents(id,tenant_id,dispatch_stop_id,fiscal_document_id) values(gen_random_uuid(),$1,$2,$3)',[i.tenant,stop,doc]);
 if(twoDocuments){const other=randomUUID();await db.query("insert into fiscal_documents(id,tenant_id,client_id,supplier_id,document_type,status,invoice_number,value) values($1,$2,$3,$3,'inbound','ready','NF-DESCARGA-2',500)",[other,i.tenant,payer]);await db.query('insert into dispatch_stop_documents(id,tenant_id,dispatch_stop_id,fiscal_document_id) values(gen_random_uuid(),$1,$2,$3)',[i.tenant,stop,other]);}
 const context=(await operationRpc<{v:{revision:string}}>(db,'select get_finance_delivery_context($1,$2) v',[i.tenant,stop])).rows[0].v;
 const result=(await operationRpc<{v:{charge_id:string;receivable_id:string}}>(db,'select record_finance_unloading($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),stop_id:stop,expected_revision:context.revision,amount_cents:amount,occurred_on:day,due_date:'2026-02-28',receipt_path:i.tenant+'/proof/unloading.pdf',reason:'Cobrança de descarga conferida'}])).rows[0].v;
 return{...result,supplier:payer,doc,stop};
}

async function read(origin='all',page=1,client:string|null=null){return receivablesOriginPageSchema.parse((await operationRpc<{v:unknown}>(db,'select get_finance_receivables_page_by_origin($1,$2,$3,$4,$5,$6,$7,$8) v',[i.tenant,'','all',client,null,null,page,origin])).rows[0].v);}
it('finds the unloading charge across more than 1000 titles and filters before pagination',async()=>{
 const c=await charge();
 await db.query("insert into receivables(id,tenant_id,description,amount,status,received_amount,created_at,updated_at) select gen_random_uuid(),$1,'Outro QA '||n,10,'pending',0,clock_timestamp(),clock_timestamp() from generate_series(1,1005) n",[i.tenant]);
 const result=await read('unloading');expect(result).toMatchObject({version:2,origin_filter:'unloading',total:1,total_unfiltered:1006});expect(result.rows.map(r=>r.id)).toEqual([c.receivable_id]);
 expect(await read('other',21)).toMatchObject({total:1005});expect((await read('other',21)).rows).toHaveLength(5);
 expect((await read('fiscal')).total).toBe(0);expect((await read('unloading',1,c.supplier)).total).toBe(1);
 expect((await db.query('select id from finance_movements')).rows).toHaveLength(0);
});
it('rejects unknown origins, another company supplier and mixed driver identity',async()=>{
 await expect(read('invented')).rejects.toThrow('finance_invalid_filters');
 const other=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Outro devedor',true)",[other,i.otherTenant]);
 await expect(read('all',1,other)).rejects.toThrow('finance_client_not_found');
 await db.query('insert into drivers(id,tenant_id,user_id,active) values(gen_random_uuid(),$1,$2,true)',[i.tenant,i.operator]);await expect(read()).rejects.toThrow('finance_access_denied');
});

it('classifies a linked legacy fiscal title without inferring from description',async()=>{
 await db.query("insert into receivables(id,tenant_id,description,amount,status,received_amount,cte_document_id) values(gen_random_uuid(),$1,'Sem palavra fiscal',10,'pending',0,$2)",[i.tenant,randomUUID()]);
 await db.query("insert into receivables(id,tenant_id,description,amount,status,received_amount) values(gen_random_uuid(),$1,'Reembolso descarga e CTe por texto',10,'pending',0)",[i.tenant]);
 const fiscal=await read('fiscal');expect(fiscal.total).toBe(1);expect(fiscal.rows[0].description).toBe('Sem palavra fiscal');
 expect((await read('unloading')).total).toBe(0);expect((await read('other')).total).toBe(1);
 expect(()=>receivablesOriginPageSchema.parse({...fiscal,origin_filter:'unloading'})).toThrow('Origem dos títulos inconsistente.');
});
