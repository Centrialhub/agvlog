// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createLegacyReceivableAssociationDatabase} from './helpers/legacyReceivableAssociationDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {fiscalDashboardSchema} from '@/lib/financial/fiscalDashboardContract';
let db:PGlite;
beforeAll(async()=>{db=await createLegacyReceivableAssociationDatabase();await db.exec(readFileSync('supabase/migrations/20260910152711_finance_fiscal_dashboard_summary.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function read(from:string|null=null,to:string|null=null){return fiscalDashboardSchema.parse((await operationRpc<{result:Record<string,unknown>}>(db,'select get_finance_fiscal_dashboard_summary($1,$2,$3) result',[i.tenant,from,to])).rows[0].result);}
async function project(key='1'.repeat(44)){
 const payer=randomUUID(),source=randomUUID(),id=randomUUID();
 await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Cliente fiscal',true)",[payer,i.tenant]);
 await db.query('insert into cte_documents(id,tenant_id,client_id,freight_value,net_value) values($1,$2,$3,1000,990)',[source,i.tenant,payer]);
 await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number) values($1,$2,'cte','production','authorized','recorded',$3,$4,$5,'123')",[id,i.tenant,source,key,'2'.repeat(15)]);
 const observation=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1',[id])).rows[0].id;
 await operationRpc(db,'select process_finance_fiscal_observation($1,$2)',[i.tenant,observation]);return id;
}
it('summarizes real authorized projections using the authoritative CTe freight basis',async()=>{
 await project();expect(await read()).toMatchObject({total_count:1,active_count:1,invalid_count:0,totals_valid:true,net_cents:'100000',gross_cents:'100000',withheld_cents:'0'});
});
it('invalidates active totals while a cancellation has arrived but is not yet projected',async()=>{
 const id=await project();await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[id]);
 expect(await read()).toMatchObject({active_count:1,invalid_count:1,totals_valid:false,net_cents:null,pending_jobs:1});
 const observation=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[id])).rows[0].id;
 await operationRpc(db,'select process_finance_fiscal_observation($1,$2)',[i.tenant,observation]);
 expect(await read()).toMatchObject({active_count:0,cancelled_count:1,totals_valid:true,net_cents:'0'});
});
it('keeps queue coverage visible when no origin has been materialized',async()=>{
 expect(await read()).toMatchObject({basis:'fiscal_receivable_origins',date_basis:'incorporated_at',total_count:0,pending_jobs_scope:'tenant_all_dates'});
 await expect(read('2026-02-01','2026-01-01')).rejects.toThrow('finance_invalid_filters');
 await db.query('insert into drivers(id,tenant_id,user_id,active) values(gen_random_uuid(),$1,$2,true)',[i.tenant,i.operator]);await expect(read()).rejects.toThrow('finance_access_denied');
});
it('separates NFS-e withholding from the actual receivable basis',async()=>{
 const client=randomUUID(),source=randomUUID(),emission=randomUUID();
 await db.query("insert into clients(id,tenant_id,company_name,tax_id,active) values($1,$2,'Cliente fiscal','12345678000190',true)",[client,i.tenant]);
 await db.query('insert into nfse_documents(id,tenant_id,cliente_id,pagador_cnpj,valor_servicos,valor_liquido,valor_total,iss_retido,valor_iss,outras_retencoes,valor_pis,valor_cofins,valor_inss,valor_ir,valor_csll,is_preview) values($1,$2,$3,$4,1000,950,1000,true,50,0,0,0,0,0,0,false)',[source,i.tenant,client,'12345678000190']);
 await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,nfse_document_id,number,authorization_protocol,hub_document_id) values($1,$2,'nfse','production','authorized','recorded',$3,'123','protocolo','hub-nfse-123')",[emission,i.tenant,source]);
 const observation=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1',[emission])).rows[0].id;
 await operationRpc(db,'select process_finance_fiscal_observation($1,$2)',[i.tenant,observation]);
 expect(await read()).toMatchObject({active_count:1,totals_valid:true,net_cents:'95000',gross_cents:'100000',withheld_cents:'5000'});
});
it('includes more than one thousand real projected authorizations',async()=>{
 for(let n=1;n<=1001;n++)await project(String(n).padStart(44,'0'));
 expect(await read()).toMatchObject({total_count:1001,active_count:1001,totals_valid:true,net_cents:'100100000'});
},30000);
it('invalidates stale identity even when the emission remains authorized',async()=>{
 const id=await project();await db.query("update hub_fiscal_emissions set access_key=repeat('9',44) where id=$1",[id]);
 expect(await read()).toMatchObject({invalid_count:1,totals_valid:false,net_cents:null});
 const observation=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[id])).rows[0].id;
 await operationRpc(db,'select process_finance_fiscal_observation($1,$2)',[i.tenant,observation]);
 expect(await read()).toMatchObject({active_count:0,review_count:1,net_cents:'0',pending_jobs:1});
});
it('does not reclassify an active fiscal amount under an unverified payer',async()=>{
 const emission=await project(),payer=randomUUID();
 await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Outro pagador',true)",[payer,i.tenant]);
 await db.query('update receivables set client_id=$1 where id=(select receivable_id from finance_fiscal_receivable_origins where emission_id=$2)',[payer,emission]);
 expect(await read()).toMatchObject({active_count:1,invalid_count:1,totals_valid:false,net_cents:null});
});
