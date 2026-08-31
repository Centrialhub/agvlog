import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {operationRpc} from './operationOutcomeDatabase.ts';
export const chatIds={tenant:'20000000-0000-4000-8000-000000000001',otherTenant:'20000000-0000-4000-8000-000000000002',
 driver:'60000000-0000-4000-8000-000000000001',peerDriver:'60000000-0000-4000-8000-000000000002',foreignDriver:'60000000-0000-4000-8000-000000000003',
 user:'10000000-0000-4000-8000-000000000003',peerUser:'10000000-0000-4000-8000-000000000004',foreignUser:'10000000-0000-4000-8000-000000000005',
 operator:'10000000-0000-4000-8000-000000000011',admin:'10000000-0000-4000-8000-000000000012',client:'10000000-0000-4000-8000-000000000013'};
export const driverChatMigration='20260830221527_make_driver_chat_recoverable.sql';
export const driverChatSql=()=>readFileSync('supabase/migrations/'+driverChatMigration,'utf8');
function actualFunction(source:string,name:string){
 const start=source.toLowerCase().indexOf('create or replace function public.'+name+'('),end=source.indexOf('$function$;',start)+11;
 if(start<0||end<11)throw new Error('Missing actual chat identity helper '+name);return source.slice(start,end);
}
export async function installDriverChatFixture(db:PGlite){
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');
 const mfa=readFileSync('supabase/migrations/20260828210458_enforce_privileged_mfa_release.sql','utf8');
 await db.exec("create or replace function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;");
 await db.exec(actualFunction(baseline,'current_driver_id'));
 for(const name of ['is_tenant_operator_or_admin','is_user_internal_role','is_tenant_member'])await db.exec(actualFunction(mfa,name));
 if(!(await db.query<{present:boolean}>("select to_regclass('public.profiles') is not null present")).rows[0].present)await db.exec('create table public.profiles(id uuid primary key,full_name text)');
 const declaration=baseline.match(/CREATE TABLE public\.driver_direct_messages \([\s\S]*?\n\);/)?.[0];if(!declaration)throw new Error('Missing actual chat table');await db.exec(declaration);
 await db.exec(baseline.match(/ALTER TABLE ONLY public\.driver_direct_messages\n {4}ALTER COLUMN[\s\S]*?;/)![0]);
 await db.exec('alter table public.driver_direct_messages add primary key(id);alter table public.driver_direct_messages enable row level security;grant select,insert on public.driver_direct_messages to authenticated;grant usage on schema auth to authenticated;');
 const policies=readFileSync('supabase/migrations/20260825213311_consolidate_driver_message_rls.sql','utf8');
 await db.exec(policies.slice(0,policies.indexOf('drop policy if exists "Internal roles read event messages"')));
}
export async function createDriverChatDatabase(candidate=true){
 const db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table tenant_memberships(tenant_id uuid,user_id uuid,role text,active boolean,unique(tenant_id,user_id));create table drivers(id uuid primary key,tenant_id uuid,user_id uuid,name text,active boolean);");
 await installDriverChatFixture(db);const i=chatIds;
 await db.query("insert into drivers values($1,$2,$3,'Motorista QA',true),($4,$2,$5,'Colega QA',true),($6,$7,$8,'Outra empresa QA',true)",[i.driver,i.tenant,i.user,i.peerDriver,i.peerUser,i.foreignDriver,i.otherTenant,i.foreignUser]);
 await db.query("insert into tenant_memberships values($1,$2,'driver',true),($1,$3,'driver',true),($4,$5,'driver',true),($1,$6,'operator',true),($1,$7,'admin',true),($1,$8,'client',true)",[i.tenant,i.user,i.peerUser,i.otherTenant,i.foreignUser,i.operator,i.admin,i.client]);
 await db.query("insert into profiles values($1,'Operação QA'),($2,'Admin QA')",[i.operator,i.admin]);
 if(candidate)await db.exec(driverChatSql());return db;
}
export const chatActor=(db:PGlite,id=chatIds.user,aal='aal1')=>db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({aal})]);
export async function legacyChatSend(db:PGlite,{driver=chatIds.driver,role='driver',name='Nome enviado pela tela',message='Mensagem QA'}={}){
 return operationRpc(db,'insert into driver_direct_messages(tenant_id,driver_id,sender_id,sender_role,sender_name,message) values($1,$2,auth.uid(),$3,$4,$5) returning *',[chatIds.tenant,driver,role,name,message]);
}
export async function chatContext(db:PGlite,driver=chatIds.driver){return (await operationRpc<{r:{revision:string;can_send:boolean;sender_role:string}}>(db,'select get_driver_chat_context($1,$2) r',[chatIds.tenant,driver])).rows[0].r;}
export async function chatPayload(db:PGlite,actor=chatIds.user,driver=chatIds.driver,message='Mensagem QA'){
 return {version:1,tenant_id:chatIds.tenant,actor_id:actor,driver_id:driver,request_id:randomUUID(),expected_revision:(await chatContext(db,driver)).revision,message};
}
export async function chatSend(db:PGlite,payload:unknown){return (await operationRpc<{r:{message:Record<string,unknown>;confirmed:boolean;request_id:string}}>(db,'select send_driver_chat_message($1::jsonb) r',[JSON.stringify(payload)])).rows[0].r;}
export async function chatList(db:PGlite,driver=chatIds.driver,before:unknown=null){return (await operationRpc<{r:{messages:Record<string,unknown>[];next_cursor:unknown}}>(db,'select list_driver_chat_messages($1,$2,$3::jsonb) r',[chatIds.tenant,driver,JSON.stringify(before)])).rows[0].r;}
