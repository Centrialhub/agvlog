import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
// Reuse definitions already versioned in the repository. No production dump.
const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');
export const portalPrivacyMigration='20260830115234_harden_portal_shipment_detail_privacy.sql';
export const portalPrivacyCandidate=()=>readFileSync('supabase/migrations/'+portalPrivacyMigration,'utf8');
export const portalFunctions=['portal_user_can_access_fiscal_document','portal_user_can_view_financial','portal_user_can_download_fiscal_document','get_client_portal_shipment_detail','get_client_portal_shipment_detail_v2'];
export function localPortalFunction(name:string){
 const start=baseline.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'(');if(start<0)throw new Error('Local baseline function missing: '+name);
 const end=baseline.indexOf('$function$;',baseline.indexOf('AS $function$',start)+14);if(end<0)throw new Error('Local function delimiter missing');
 return baseline.slice(start,end+'$function$;'.length);
}
export const portalPrivacyIds={
 tenant:'21000000-0000-4000-8000-000000000001',otherTenant:'21000000-0000-4000-8000-000000000002',
 user:'11000000-0000-4000-8000-000000000001',otherUser:'11000000-0000-4000-8000-000000000002',
 client:'31000000-0000-4000-8000-000000000001',otherClient:'31000000-0000-4000-8000-000000000002',
 load:'71000000-0000-4000-8000-000000000001',trip:'81000000-0000-4000-8000-000000000001',stop:'83000000-0000-4000-8000-000000000001',
 doc:'91000000-0000-4000-8000-000000000001',otherDoc:'91000000-0000-4000-8000-000000000002',driver:'61000000-0000-4000-8000-000000000001',vehicle:'51000000-0000-4000-8000-000000000001',
};
const aliases:Record<string,string[]>={fiscal_documents:['_fd','fd'],loads:['l'],dispatch_trips:['dt'],dispatch_stops:['ds'],dispatch_stop_documents:['dsd'],dispatch_events:['e'],operational_events:['oe','o'],proof_of_delivery:['p'],drivers:['drv'],vehicles:['v'],clients:['c'],client_portal_access:['cpa'],dispatch_trip_loads:['dtl']};
export function portalPrivacySchema(includeRoles=true){
 const functions=portalFunctions.map(localPortalFunction).join('\n');
 const extras:Record<string,string[]>={dispatch_events:['payload','event_at','dispatch_trip_id'],dispatch_stop_documents:['load_id','created_at'],dispatch_trips:['load_id'],fiscal_documents:['deleted_at'],proof_of_delivery:['is_active','dispatch_trip_id','dispatch_stop_id'],dispatch_trip_loads:['dispatch_trip_id','load_id']};
 const tables=Object.entries(aliases).map(([table,names])=>{
  const start=baseline.indexOf('CREATE TABLE public.'+table+' (');if(start<0)throw new Error('Missing local table '+table);
  const body=baseline.slice(baseline.indexOf('\n',start)+1,baseline.indexOf('\n);',start));
  const columns=body.split('\n').map(line=>line.trim().replace(/,$/,'' )).filter(line=>{
   const name=line.split(' ')[0];return ['id','tenant_id'].includes(name)||table==='client_portal_access'||extras[table]?.includes(name)||names.some(alias=>new RegExp('\\b'+alias+'\\.'+name+'\\b').test(functions));
  }).map(line=>{
   // Explicit synthetic defaults for fixture convenience, not a production schema claim.
   if(line.startsWith('id uuid'))return line+' default gen_random_uuid() primary key';
   if(line.includes('timestamp with time zone NOT NULL'))return line+' default now()';
   if(line.includes('boolean NOT NULL'))return line+' default false';
   if(line.includes('integer NOT NULL'))return line+' default 0';return line;
  });return 'create table public.'+table+'('+columns.join(',')+');';
 });
 return (includeRoles?'create role anon;create role authenticated;create role service_role;':'')+"create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+tables.join('\n')+functions+';'+portalFunctions.map(name=>`revoke all on function public.${name} from public,anon,authenticated,service_role;grant execute on function public.${name} to service_role;`+(name.startsWith('get_client_')?`grant execute on function public.${name} to authenticated;`:'')).join('\n');
}
export async function createPortalPrivacyDatabase(candidate=false){const db=new PGlite();await db.exec(portalPrivacySchema());if(candidate)await db.exec(portalPrivacyCandidate());await seedPortalPrivacy(db);return db;}
export async function seedPortalPrivacy(db:PGlite){
 const i=portalPrivacyIds;
 await db.query('insert into clients(id,tenant_id,tax_id) values($1,$2,\'CNPJ-QA-A\'),($3,$2,\'CNPJ-QA-B\')',[i.client,i.tenant,i.otherClient]);
 await db.query("insert into client_portal_access(tenant_id,user_id,client_id,access_type,active) values($1,$2,$3,'viewer',true)",[i.tenant,i.user,i.client]);
 await db.query("insert into drivers(id,tenant_id,name,phone) values($1,$2,'Motorista protegido','TELEFONE-PRIVADO')",[i.driver,i.tenant]);
 await db.query("insert into vehicles(id,tenant_id,plate) values($1,$2,'PLACA-PRIVADA')",[i.vehicle,i.tenant]);
 await db.query("insert into loads(id,tenant_id,load_number,status) values($1,$2,'QA-PORTAL','in_transit')",[i.load,i.tenant]);
 await db.query("insert into dispatch_trips(id,tenant_id,load_id,driver_id,vehicle_id,status,actual_start_at) values($1,$2,$3,$4,$5,'in_transit',now()-interval '1 hour')",[i.trip,i.tenant,i.load,i.driver,i.vehicle]);
 await db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)',[i.tenant,i.trip,i.load]);
 await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status,destination,actual_arrival_at) values($1,$2,$3,'arrived','Destino QA',now())",[i.stop,i.tenant,i.trip]);
 await db.query("insert into fiscal_documents(id,tenant_id,client_id,load_id,document_type,status,invoice_number,value,freight_value) values($1,$2,$3,$4,'inbound','in_transit','PORTAL-A',1234,123),($5,$2,$6,$4,'inbound','in_transit','PORTAL-B',5678,567)",[i.doc,i.tenant,i.client,i.load,i.otherDoc,i.otherClient]);
 await db.query('insert into dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id,load_id) values($1,$2,$3,$4),($1,$2,$5,$4)',[i.tenant,i.stop,i.doc,i.load,i.otherDoc]);
 await db.query("insert into dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,notes,payload) values($1,$2,$3,'operation_document_outcome','QA-NOTA-INTERNA-CONFIDENCIAL','{}'),($1,$2,$3,'arrival','QA-NOTA-INTERNA-NA-CHEGADA','{}')",[i.tenant,i.trip,i.stop]);
 await db.query("insert into operational_events(tenant_id,client_id,load_id,dispatch_stop_id,fiscal_document_id,event_type,severity,description,visible_to_client,public_status) values($1,$2,$3,$4,$5,'other','medium','QA-OCORRENCIA-INTERNA',false,'open'),($1,$6,$3,$4,$7,'other','medium','QA-OCORRENCIA-OUTRO-CLIENTE',true,'open'),($1,$2,$3,$4,$5,'delivery_delay','low','Aviso público desta nota',true,'resolved')",[i.tenant,i.client,i.load,i.stop,i.doc,i.otherClient,i.otherDoc]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
}
export async function portalDetail(db:PGlite,version='v2',doc=portalPrivacyIds.doc){
 await db.exec('savepoint portal_read;set role authenticated');
 try{const r=await db.query<{result:Record<string,unknown>}>(`select public.get_client_portal_shipment_detail${version==='v2'?'_v2':''}($1) result`,[doc]);await db.exec('reset role;release savepoint portal_read');return r.rows[0].result;}
 catch(e){await db.exec('rollback to savepoint portal_read;release savepoint portal_read');throw e;}
}
