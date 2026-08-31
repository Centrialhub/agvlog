import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createOperationDatabase,operationIds} from './operationOutcomeDatabase.ts';
import {localPortalFunction,portalPrivacyCandidate} from './portalPrivacyDatabase.ts';
export const proofVersionMigration='20260830120554_version_delivery_proof_evidence.sql';
export const proofVersionSql=()=>readFileSync('supabase/migrations/'+proofVersionMigration,'utf8');
export const proofReaders=['get_client_portal_summary','search_client_portal_shipments','list_client_documents','get_public_shipment_status',
 'get_client_portal_summary_v2','get_client_portal_upcoming_deliveries','get_client_portal_alerts','get_client_portal_reports_summary',
 'get_client_portal_tracking','list_client_documents_v2','search_client_portal_shipments_v2','get_client_portal_reports_summary_v2',
 'list_client_pods','list_client_pods_v2','get_client_portal_shipment_detail','get_client_portal_shipment_detail_v2'];
const authHelpers=['_portal_user_client_ids','portal_user_can_access_fiscal_document','portal_user_can_view_financial','portal_user_can_download_fiscal_document',
 'portal_user_can_access_pickup_order','portal_user_can_access_operational_event','_portal_assert_client_access'];
const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');

// Add only local-baseline columns needed to exercise the real portal functions.
// Synthetic nullable/default choices are explicit; this is not a production dump
// or a claim of complete hosted RLS/Auth/Storage schema parity.
export async function installProofReaderFixture(db:PGlite){
 for(const declaration of baseline.matchAll(/CREATE TYPE public\.(\w+) AS ENUM \([\s\S]*?\);/g)){
  const result=await db.query<{exists:boolean}>('select to_regtype($1) is not null as exists',['public.'+declaration[1]]);
  if(!result.rows[0].exists)await db.exec(declaration[0]);
 }
 const definitions=[...authHelpers,...proofReaders,'get_client_pod_metadata'].map(localPortalFunction);
 const tables=new Set(definitions.flatMap(def=>[...def.matchAll(/\b(?:from|join)\s+public\.(\w+)/gi)].map(match=>match[1])));
 for(const table of tables){
  const start=baseline.indexOf('CREATE TABLE public.'+table+' (');if(start<0)continue;
  const body=baseline.slice(baseline.indexOf('\n',start)+1,baseline.indexOf('\n);',start));
  const fields=body.split('\n').map(line=>line.trim().replace(/,$/,'').replace(/ NOT NULL$/,''));
  const {rows}=await db.query<{column_name:string}>('select column_name from information_schema.columns where table_schema=\'public\' and table_name=$1',[table]);
  if(rows.length===0){await db.exec('create table public.'+table+'('+fields.map(f=>f.startsWith('id uuid')?f+' primary key default gen_random_uuid()':f).join(',')+')');}
  else{const columns=new Set(rows.map(row=>row.column_name));for(const f of fields)if(!columns.has(f.split(' ')[0]))await db.exec('alter table public.'+table+' add column '+f);}
 }
 await db.exec(`alter table proof_of_delivery rename constraint proof_of_delivery_fiscal_document_id_key to uq_pod_fiscal_document;
  update proof_of_delivery set version=1,is_active=true;
  alter table proof_of_delivery alter column version set default 1,alter column version set not null,
   alter column is_active set default true,alter column is_active set not null,alter column created_at set default now();`);
 for(const definition of definitions)await db.exec(definition);
 for(const name of [...authHelpers,...proofReaders,'get_client_pod_metadata'])await db.exec(`revoke all on function public.${name} from public,anon,authenticated,service_role;grant execute on function public.${name} to service_role;`+
  (proofReaders.includes(name)||name==='get_client_pod_metadata'?`grant execute on function public.${name} to authenticated;`:''));
 await db.exec(portalPrivacyCandidate());
}
export async function createProofVersionDatabase(candidate=true){
 const result=await createOperationDatabase();await installProofReaderFixture(result.db);
 await result.db.exec('update fiscal_documents set created_at=now(),issue_date=current_date');
 if(candidate)await result.db.exec(proofVersionSql());return result;
}
export async function seedHistoricalProof(db:PGlite,trip:string,stop:string,document=operationIds.doc){
 const i=operationIds;
 const proof=(await db.query<{id:string}>(`insert into proof_of_delivery(tenant_id,fiscal_document_id,load_id,dispatch_trip_id,dispatch_stop_id,
  proof_type,status,storage_bucket,storage_path,receiver_name,received_at,version,is_active,metadata)
  values($1,$2,$3,$4,$5,'receiver_confirmation','uploaded','receipts','QA-ORIGINAL-RECEIPT','Recebedor anterior',now(),1,true,'{}') returning id`,[i.tenant,document,i.load,trip,stop])).rows[0].id;
 const event=(await db.query<{id:string}>(`insert into dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,notes,payload,created_by)
  values($1,$2,$3,'redelivery_requested','Nova tentativa confirmada pela operação',jsonb_build_object('source','operation','document_id',$4::text),$5) returning id`,[i.tenant,trip,stop,document,i.operator])).rows[0].id;
 await db.query('select _retire_delivery_proof($1,$2,$3)',[i.tenant,document,event]);return {proof,event};
}
export async function authorizeProofPortalViewer(db:PGlite){const i=operationIds;
 await db.query(`insert into client_portal_access(tenant_id,user_id,client_id,access_type,active,
  can_view_financial,can_download_documents,can_open_occurrences,can_request_pickup,can_view_vehicle_live,can_view_driver_contact)
 values($1,$2,$3,'viewer',true,false,true,false,false,false,false)`,[i.tenant,i.operator,i.client]);
}
