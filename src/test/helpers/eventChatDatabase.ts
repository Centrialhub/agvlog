import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {chatIds,createDriverChatDatabase} from './driverChatDatabase.ts';
import {operationRpc} from './operationOutcomeDatabase.ts';
export const eventChatIds={...chatIds,event:'ec100000-0000-4000-8000-000000000001',peerEvent:'ec100000-0000-4000-8000-000000000002',foreignEvent:'ec100000-0000-4000-8000-000000000003',unassignedEvent:'ec100000-0000-4000-8000-000000000004',trip:'ec200000-0000-4000-8000-000000000001',stop:'ec300000-0000-4000-8000-000000000001'};
export async function installEventChatFixture(db:PGlite){
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');
 for(const [table,ddl] of Object.entries({operational_events:'id uuid primary key,tenant_id uuid,driver_id uuid,dispatch_trip_id uuid,dispatch_stop_id uuid,event_type text,description text,created_at timestamptz default now(),report_details jsonb,payload jsonb,severity text',dispatch_trips:'id uuid primary key,tenant_id uuid,driver_id uuid',dispatch_stops:'id uuid primary key,tenant_id uuid,dispatch_trip_id uuid'}))
  if(!(await db.query<{present:boolean}>("select to_regclass('public."+table+"') is not null present")).rows[0].present)await db.exec('create table public.'+table+'('+ddl+')');
 for(const name of ['driver_owns_trip','driver_owns_stop']){const start=baseline.toLowerCase().indexOf('create or replace function public.'+name+'('),end=baseline.indexOf('$function$;',start)+11;if(start<0||end<11)throw Error('Missing actual helper');await db.exec(baseline.slice(start,end));}
 await db.exec('alter table public.operational_events enable row level security;grant select on public.operational_events to authenticated;');
 for(const name of ['Internal roles view operational_events','operational_events_select_driver']){
  const line=baseline.split('\n').find(l=>l.startsWith('CREATE POLICY ')&&l.includes(name));if(!line)throw Error('Missing actual event policy');
  if(!(await db.query<{present:boolean}>('select exists(select 1 from pg_policy where polrelid=\'public.operational_events\'::regclass and polname=$1) present',[name])).rows[0].present)await db.exec(line);
 }
 const declaration=baseline.match(/CREATE TABLE public\.operational_event_messages \([\s\S]*?\n\);/)?.[0];if(!declaration)throw Error('Missing event message table');await db.exec(declaration);
 await db.exec(baseline.match(/ALTER TABLE ONLY public\.operational_event_messages\n {4}ALTER COLUMN[\s\S]*?;/)![0]);
 await db.exec('alter table public.operational_event_messages add primary key(id);alter table public.operational_event_messages enable row level security;grant select,insert on public.operational_event_messages to authenticated;');
 const policies=readFileSync('supabase/migrations/20260825213311_consolidate_driver_message_rls.sql','utf8');await db.exec(policies.slice(policies.indexOf('drop policy if exists "Internal roles read event messages"')));
}
export const eventChatSql=()=>readFileSync('supabase/migrations/20260830224344_make_event_chat_recoverable.sql','utf8');
export async function createEventChatDatabase(candidate=false){
 const db=await createDriverChatDatabase();await installEventChatFixture(db);const i=eventChatIds;
 await db.query('insert into dispatch_trips values($1,$2,$3);',[i.trip,i.tenant,i.driver]);await db.query('insert into dispatch_stops values($1,$2,$3);',[i.stop,i.tenant,i.trip]);
 await db.query("insert into operational_events(id,tenant_id,driver_id,dispatch_trip_id,dispatch_stop_id,event_type,description,severity) values($1,$2,$3,$4,$5,'other','Ocorrência QA','low'),($6,$2,$7,null,null,'other','Outra ocorrência QA','low'),($8,$9,$10,null,null,'other','Outra empresa','low'),($11,$2,null,null,null,'other','Discussão interna','low')",[i.event,i.tenant,i.driver,i.trip,i.stop,i.peerEvent,i.peerDriver,i.foreignEvent,i.otherTenant,i.foreignDriver,i.unassignedEvent]);
 if(candidate)await db.exec(eventChatSql());return db;
}
export async function legacyEventSend(db:PGlite,event=eventChatIds.event,role='driver',name='Nome da tela'){
 return operationRpc(db,'insert into operational_event_messages(tenant_id,event_id,sender_id,sender_role,sender_name,message) values($1,$2,auth.uid(),$3,$4,$5) returning *',[eventChatIds.tenant,event,role,name,'Mensagem QA']);
}
export async function eventContext(db:PGlite,event=eventChatIds.event){return (await operationRpc<{r:{revision:string;driver_id:string|null;can_send:boolean;audience:string}}>(db,'select get_event_chat_context($1,$2) r',[eventChatIds.tenant,event])).rows[0].r;}
export async function eventPayload(db:PGlite,actor=eventChatIds.user,event=eventChatIds.event,message='Mensagem da ocorrência'){
 const c=await eventContext(db,event);return {version:1,tenant_id:eventChatIds.tenant,actor_id:actor,driver_id:c.driver_id,event_id:event,request_id:randomUUID(),expected_revision:c.revision,message};
}
export async function eventSend(db:PGlite,p:unknown){return (await operationRpc<{r:Record<string,unknown>}>(db,'select send_event_chat_message($1::jsonb) r',[JSON.stringify(p)])).rows[0].r;}
export async function eventList(db:PGlite,event=eventChatIds.event,cursor:unknown=null){return (await operationRpc<{r:{messages:Record<string,unknown>[];next_cursor:unknown}}>(db,'select list_event_chat_messages($1,$2,$3::jsonb) r',[eventChatIds.tenant,event,JSON.stringify(cursor)])).rows[0].r;}
