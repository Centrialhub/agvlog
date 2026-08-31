import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createClosingDraftDatabase,closingDraftPayload,createClosingDraft} from './closingDraftDatabase.ts';
import {closingSources,closingSourceFilters} from './closingSourcesDatabase.ts';
import {operationIds as i,operationRpc} from './operationOutcomeDatabase.ts';
const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');
export const closingLifecycleMigration='20260830174819_audit_closing_lifecycle_and_charge_claims.sql';
export const closingLifecycleSql=()=>readFileSync('supabase/migrations/'+closingLifecycleMigration,'utf8');
export const closingChargeFixtureIds={client:'cf500000-0000-4000-8000-000000000001',load:'cf500000-0000-4000-8000-000000000002',
 doc:'cf500000-0000-4000-8000-000000000003',doc2:'cf500000-0000-4000-8000-000000000004',cte:'cf500000-0000-4000-8000-000000000005'};
export async function seedClosingChargeFixture(db:PGlite){
 const f=closingChargeFixtureIds;
 // New synthetic sources only. Do not modify prior attempt snapshots, amounts
 // or financial-review flags just to make the native concurrency scenario pass.
 await db.exec(`insert into clients(id,tenant_id,active) values('${f.client}','${i.tenant}',true);
  insert into loads(id,tenant_id,status,load_number) values('${f.load}','${i.tenant}','draft','QA-CLOSING-CLAIM');
  insert into fiscal_documents(id,tenant_id,load_id,client_id,document_type,status,issue_date,invoice_number,value,weight_kg,freight_value)
   values('${f.doc}','${i.tenant}','${f.load}','${f.client}','inbound','ready',(clock_timestamp() at time zone 'America/Sao_Paulo')::date,'QA-CLAIM-1',1000,10,50),
         ('${f.doc2}','${i.tenant}','${f.load}','${f.client}','inbound','ready',(clock_timestamp() at time zone 'America/Sao_Paulo')::date,'QA-CLAIM-2',1000,10,50);
  insert into cte_documents(id,tenant_id,cte_number,freight_value,load_ids,fiscal_document_ids,status,sefaz_status,sefaz_environment,is_voided)
   values('${f.cte}','${i.tenant}','CTE-QA-CLAIM',100,array['${f.load}']::uuid[],array['${f.doc}','${f.doc2}']::uuid[],'authorized','authorized','production',false);`);
}
export async function installClosingLifecycleFixture(db:PGlite){
 for(const table of ['client_invoice_charges','client_invoice_details','client_invoice_sequences','bank_accounts','bank_transactions','receivables_payments']){
  const exists=(await db.query<{exists:boolean}>('select to_regclass($1) is not null as exists',['public.'+table])).rows[0].exists;
  if(!exists){const declaration=baseline.match(new RegExp('CREATE TABLE public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0];if(!declaration)throw new Error('Missing baseline '+table);await db.exec(declaration);
   for(const match of baseline.matchAll(new RegExp('ALTER TABLE ONLY public\\.'+table+'\\n    ALTER COLUMN[\\s\\S]*?;','g')))await db.exec(match[0]);
   await db.exec('alter table public.'+table+' add primary key('+ (table==='client_invoice_sequences'?'tenant_id,sequence_year':'id')+')');
  }
 }
 // Install the actual invoice/receivable ledger functions, not fake successful
 // payment or billing stubs. Fixtures still do not contact banking providers.
 await db.exec(readFileSync('supabase/migrations/20260828123509_harden_client_invoice_tenant_contract.sql','utf8'));
 for(const name of ['next_client_invoice_number','register_receivable_payment','_recalc_receivable_received','cancel_client_invoice']){
  const start=baseline.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');const end=baseline.indexOf('$function$;',start)+12;
  if(start<0||end<start)throw new Error('Missing function '+name);await db.exec(baseline.slice(start,end));
 }
 await db.exec('create trigger trg_recalc_receivable_received after insert or delete or update on public.receivables_payments for each row execute function public._recalc_receivable_received();');
}
export async function createClosingLifecycleDatabase(){
 const value=await createClosingDraftDatabase();await installClosingLifecycleFixture(value.db);await value.db.exec(closingLifecycleSql());return value;
}
export async function closingActionContext(db:PGlite,report:string,tenant:string=i.tenant){
 return (await operationRpc<{result:{revision:number;status:string;allowed_actions:string[];source_review_required:boolean}}>(db,'select get_closing_report_action_context($1,$2) result',[tenant,report])).rows[0].result;
}
let sequence=1;
export async function closingActionPayload(db:PGlite,report:string,action='close'){
 return {version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:'cf100000-0000-4000-8000-'+String(sequence++).padStart(12,'0'),report_id:report,
  expected_revision:(await closingActionContext(db,report)).revision,action,reason:'Conferência financeira QA'};
}
export async function closingAction(db:PGlite,payload:unknown){
 return (await operationRpc<{result:{revision:number;status:string;action:string;changed:boolean;report_id:string}}>(db,'select apply_closing_report_action($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
}
export async function createClosingWithClient(db:PGlite,requestId?:string){
 const client=(await db.query<{id:string}>('select id from clients where tenant_id=$1 order by id limit 1',[i.tenant])).rows[0].id;
 await db.query('update fiscal_documents set client_id=$1 where tenant_id=$2',[client,i.tenant]);
 const filters={...closingSourceFilters,client_id:client};const source=await closingSources(db,filters) as {revision:string};const base=await closingDraftPayload(db);
 return createClosingDraft(db,{...base,request_id:requestId??base.request_id,header:{...base.header,client_id:client},system:{...base.system,filters,revision:source.revision}});
}
