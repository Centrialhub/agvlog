import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createDocumentMetadataDatabase} from './documentMetadataDatabase.ts';
import {operationIds as i,operationRpc} from './operationOutcomeDatabase.ts';
export const closingSourcesMigration='20260830161722_make_closing_reports_attempt_aware.sql';
export const closingSourcesSql=()=>readFileSync('supabase/migrations/'+closingSourcesMigration,'utf8');
const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');
// Reuse the real delivery migration chain. These extra columns come only from
// the checked-in baseline; nullable fixture defaults are not hosted parity.
export async function installClosingSourcesFixture(db:PGlite){
 for(const table of ['cte_documents','loads','vehicles','drivers','fiscal_documents']){
  const start=baseline.indexOf('CREATE TABLE public.'+table+' (');
  if(start<0)throw new Error('Missing local baseline table '+table);
  const body=baseline.slice(baseline.indexOf('\n',start)+1,baseline.indexOf('\n);',start));
  const fields=body.split('\n').map(line=>line.trim().replace(/,$/,'').replace(/ NOT NULL(?: DEFAULT .*)?$/,''));
  const {rows}=await db.query<{column_name:string}>("select column_name from information_schema.columns where table_schema='public' and table_name=$1",[table]);
  if(!rows.length)await db.exec('create table public.'+table+'('+fields.map(f=>f.startsWith('id uuid')?f+' primary key default gen_random_uuid()':f).join(',')+')');
  else{const columns=new Set(rows.map(row=>row.column_name));for(const f of fields)if(!columns.has(f.split(' ')[0]))await db.exec('alter table public.'+table+' add column '+f);}
 }
}
export async function createClosingSourcesDatabase(){
 const result=await createDocumentMetadataDatabase();await installClosingSourcesFixture(result.db);
 await result.db.query("update fiscal_documents set issue_date='2026-08-01',value=1000,freight_value=80,volume_count=10,freight_cif_value=80,freight_fob_value=0 where tenant_id=$1",[i.tenant]);
 await result.db.exec(closingSourcesSql());return result;
}
export const closingSourceFilters={period_start:'2026-08-01',period_end:'2026-08-31'};
export async function closingSources(db:PGlite,filters:Record<string,unknown>=closingSourceFilters,tenant=i.tenant){
 return (await operationRpc<{result:unknown}>(db,'select get_closing_report_sources($1,$2::jsonb) result',[tenant,JSON.stringify(filters)])).rows[0].result;
}
export async function seedClosingCte(db:PGlite,patch:Record<string,unknown>={}){
 const value={id:'ce000000-0000-4000-8000-000000000001',tenant_id:i.tenant,cte_number:'CTE-QA',freight_value:100,
  load_ids:[i.load],fiscal_document_ids:[i.doc,i.doc2],status:'authorized',sefaz_status:'authorized',sefaz_environment:'production',
  is_voided:false,...patch};
 await db.query(`insert into cte_documents(id,tenant_id,cte_number,freight_value,load_ids,fiscal_document_ids,status,sefaz_status,sefaz_environment,is_voided)
  select id,tenant_id,cte_number,freight_value,load_ids,fiscal_document_ids,status,sefaz_status,sefaz_environment,is_voided
  from jsonb_populate_record(null::cte_documents,$1::jsonb)`,[JSON.stringify(value)]);return value;
}
