import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createRedeliveryDatabase} from './redeliveryDatabase.ts';
import {operationIds as i,operationRpc} from './operationOutcomeDatabase.ts';

export const operatorEventMigration='20260901010000_add_operator_pod_and_occurrence_commands.sql';
export const operatorEventSql=()=>readFileSync('supabase/migrations/'+operatorEventMigration,'utf8');
export const inconsistentResolvedEvent='ec900000-0000-4000-8000-000000000001';

// The delivery fixture intentionally models only tables exercised by earlier
// migrations. Extend it with the baseline occurrence columns/messages needed by
// this contract, then execute the real candidate migration unchanged.
async function installOperatorEventFixture(db:PGlite){
 await db.exec(`
  alter table public.operational_events
    add column if not exists order_id uuid,
    add column if not exists financial_impact numeric,
    add column if not exists resolution text,
    add column if not exists resolved_at timestamptz,
    add column if not exists created_at timestamptz,
    add column if not exists updated_at timestamptz,
    add column if not exists client_opened boolean default false,
    add column if not exists proof_of_delivery_id uuid;
  alter table public.orders
    add column if not exists client_id uuid,
    add column if not exists status text,
    add column if not exists updated_at timestamptz;
  create table if not exists public.client_occurrence_messages(
    id uuid primary key default gen_random_uuid(),tenant_id uuid not null,occurrence_id uuid not null,
    author_user_id uuid,author_role text not null,message text not null,created_at timestamptz not null default clock_timestamp()
  );
  create table if not exists public.operational_event_messages(
    id uuid primary key default gen_random_uuid(),tenant_id uuid not null,event_id uuid not null,sender_id uuid,
    sender_role text not null,sender_name text,message text not null,attachment_url text,
    created_at timestamptz not null default clock_timestamp()
  );
  create unique index if not exists event_chat_event_scope on public.operational_events(tenant_id,id);
  alter table public.operational_event_messages add constraint event_chat_event_scope_fkey
    foreign key(tenant_id,event_id) references public.operational_events(tenant_id,id) on delete restrict not valid;
 `);
 await db.query(`insert into public.operational_events(id,tenant_id,client_id,event_type,severity,description,resolution,resolved_at,
  created_at,updated_at,visible_to_client,client_action_required,client_opened,public_status)
  values($1,$2,$3,'other','medium','Ocorrência histórica resolvida','Tratativa histórica confirmada',now(),now(),now(),true,true,false,'open')`,
 [inconsistentResolvedEvent,i.tenant,i.client]);
 await db.exec(operatorEventSql());
}

export async function createOperatorEventDatabase(){
 const value=await createRedeliveryDatabase();await installOperatorEventFixture(value.db);return value;
}

export const defaultEventBindings=(trip:string,stop:string)=>({load_id:i.load,vehicle_id:i.vehicle,driver_id:i.driver,
 client_id:i.client,dispatch_trip_id:trip,dispatch_stop_id:stop,fiscal_document_id:i.doc});

export async function podHistory(db:PGlite,document=i.doc){
 return (await operationRpc<{result:Record<string,unknown>}>(db,
  'select get_operator_pod_history_v1($1,$2) result',[i.tenant,document])).rows[0].result;
}

export async function eventCreateContext(db:PGlite,bindings:Record<string,unknown>){
 return (await operationRpc<{result:{revision:string;bindings:Record<string,unknown>}}>(db,
  'select get_operational_event_create_context($1,$2::jsonb) result',[i.tenant,JSON.stringify(bindings)])).rows[0].result;
}

export async function eventCreatePayload(db:PGlite,bindings:Record<string,unknown>,overrides:Record<string,unknown>={}){
 const context=await eventCreateContext(db,bindings);
 return {version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),expected_revision:context.revision,
  event_type:'other',severity:'medium',description:'Ocorrência operacional conferida pela equipe QA',financial_impact_cents:0,
  visible_to_client:true,client_action_required:true,bindings,...overrides};
}

export async function createOperationalEvent(db:PGlite,payload:unknown){
 return (await operationRpc<{result:Record<string,unknown>}>(db,'select create_operational_event_v1($1::jsonb) result',
  [JSON.stringify(payload)])).rows[0].result;
}

export async function eventContext(db:PGlite,event:string){
 return (await operationRpc<{result:{revision:string;event:Record<string,unknown>}}>(db,
  'select get_operational_event_context($1,$2) result',[i.tenant,event])).rows[0].result;
}

export async function eventResolvePayload(db:PGlite,event:string,overrides:Record<string,unknown>={}){
 const context=await eventContext(db,event);
 return {version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),event_id:event,
  expected_revision:context.revision,resolution:'Tratativa validada e encerrada pela operação QA',...overrides};
}

export async function resolveOperationalEvent(db:PGlite,payload:unknown){
 return (await operationRpc<{result:Record<string,unknown>}>(db,'select resolve_operational_event_v1($1::jsonb) result',
  [JSON.stringify(payload)])).rows[0].result;
}
