// @vitest-environment node
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {operationIds as i,operationPayload,operationRpc,recordOperation} from './helpers/operationOutcomeDatabase';
import {correctOperation,correctionPayload,seedCorrectableOutcome} from './helpers/operationCorrectionDatabase';
import {requestRedelivery,redeliveryPayload} from './helpers/redeliveryDatabase';
import {ownerStatement,seedUndelivered} from './helpers/deliveryAttemptDatabase';
import {createOperatorEventDatabase,createOperationalEvent,defaultEventBindings,eventCreateContext,
 eventCreatePayload,eventResolvePayload,inconsistentResolvedEvent,operatorEventSql,podHistory,resolveOperationalEvent} from './helpers/operatorEventDatabase';

let db:PGlite;let trip:string;let stop:string;
beforeAll(async()=>{({db,trip,stop}=await createOperatorEventDatabase());},40000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});

describe('operator POD history and recoverable occurrence commands',()=>{
 it('backfills an already-resolved public lifecycle with explicit audit evidence',async()=>{
  expect((await db.query('select public_status,client_action_required from operational_events where id=$1',[inconsistentResolvedEvent])).rows[0])
   .toEqual({public_status:'resolved',client_action_required:false});
  expect((await db.query("select action,source from entity_audit_log where entity_id=$1",[inconsistentResolvedEvent])).rows)
   .toEqual([{action:'repair_public_resolution',source:'operator_event_resolution_backfill'}]);
 });

 it('does not infer delivery from an arrived stop without a canonical outcome',async()=>{
  const history=await podHistory(db) as {canonical_state:string;delivered:boolean;arrival_without_outcome:boolean;outcomes:unknown[];proofs:unknown[]};
  expect(history).toMatchObject({canonical_state:'pending',delivered:false,arrival_without_outcome:true});
  expect(history.outcomes).toEqual([]);expect(history.proofs).toEqual([]);
 });

 it('reports delivery only from the active outcome and includes the pending proof version',async()=>{
  await recordOperation(db,await operationPayload(db,stop));
  const history=await podHistory(db) as {canonical_state:string;delivered:boolean;current_outcome:{outcome:string};outcomes:unknown[];proofs:unknown[]};
  expect(history).toMatchObject({canonical_state:'delivered',delivered:true,current_outcome:{outcome:'delivered'}});
  expect(history.outcomes).toHaveLength(1);expect(history.proofs).toEqual([expect.objectContaining({version:1,is_active:true,status:'pending'})]);
 });

 it('uses the current attempt rather than an old result after audited redelivery',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));
  const history=await podHistory(db) as {canonical_state:string;delivered:boolean;current_outcome:unknown;attempts:unknown[];outcomes:unknown[]};
  expect(history).toMatchObject({canonical_state:'pending_redelivery',delivered:false,current_outcome:null});
  expect(history.attempts).toEqual([expect.objectContaining({is_current:true})]);expect(history.outcomes).toHaveLength(1);
 });

 it('exposes correction lineage while using only the corrected current outcome',async()=>{
  const first=await seedCorrectableOutcome(db,stop);await correctOperation(db,await correctionPayload(db,stop));
  const history=await podHistory(db) as {canonical_state:string;delivered:boolean;current_outcome:{outcome:string};outcomes:Array<{id:string;superseded_by:string|null}>};
  expect(history).toMatchObject({canonical_state:'not_delivered',delivered:false,current_outcome:{outcome:'not_delivered'}});
  expect(history.outcomes).toHaveLength(2);expect(history.outcomes.find(row=>row.id===first.history_id)?.superseded_by).toEqual(expect.any(String));
 });

 it('derives the client from the canonical document graph and creates exactly once under concurrent replay',async()=>{
  const bindings=defaultEventBindings(trip,stop);delete (bindings as {client_id?:string}).client_id;
  const payload=await eventCreatePayload(db,bindings);const [first,replay]=await Promise.all([
   createOperationalEvent(db,payload),createOperationalEvent(db,payload),
  ]);
  expect(replay).toEqual(first);expect(first).toMatchObject({action:'create',confirmed:true,public_status:'open'});
  expect((await db.query('select client_id,visible_to_client,client_action_required,public_status from operational_events where id=$1',[first.event_id])).rows[0])
   .toEqual({client_id:i.client,visible_to_client:true,client_action_required:true,public_status:'open'});
  expect((await db.query('select count(*)::int n from operational_event_commands')).rows[0]).toEqual({n:1});
  await expect(createOperationalEvent(db,{...payload,description:'Conteúdo diferente com a mesma chave QA'})).rejects.toThrow('operational_event_request_key_mismatch');
 });

 it('rejects a stale creation revision and rolls the whole command back',async()=>{
  const payload=await eventCreatePayload(db,defaultEventBindings(trip,stop));await db.query('update loads set updated_at=clock_timestamp() where id=$1',[i.load]);
  await expect(createOperationalEvent(db,payload)).rejects.toThrow('operational_event_context_changed');
  expect((await db.query("select count(*) filter(where payload->>'source'='create_operational_event_v1')::int events,(select count(*) from operational_event_commands)::int commands from operational_events")).rows[0])
   .toEqual({events:0,commands:0});
 });

 it('fails closed for another tenant, foreign bindings and a direct cross-tenant FK write',async()=>{
  await expect(operationRpc(db,'select get_operator_pod_history_v1($1,$2)',[i.otherTenant,i.doc])).rejects.toThrow('pod_history_not_authorized');
  await expect(eventCreateContext(db,{driver_id:i.otherDriver})).rejects.toThrow('operational_event_binding_not_found');
  await expect(db.query(`insert into operational_events(id,tenant_id,driver_id,event_type,severity,created_at,updated_at,
    visible_to_client,client_action_required,client_opened) values($1,$2,$3,'other','low',now(),now(),false,false,false)`,
   [randomUUID(),i.tenant,i.otherDriver])).rejects.toThrow(/operational_events_driver_tenant_fkey|foreign key/i);
 });

 it('denies POD and occurrence contexts to a driver or inactive operator',async()=>{
  const createPayload=await eventCreatePayload(db,defaultEventBindings(trip,stop));
  const created=await createOperationalEvent(db,createPayload);const resolvePayload=await eventResolvePayload(db,created.event_id as string);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  await expect(operationRpc(db,'select get_operator_pod_history_v1($1,$2)',[i.tenant,i.doc])).rejects.toMatchObject({code:'42501'});
  await expect(operationRpc(db,"select get_operational_event_create_context($1,'{}'::jsonb)",[i.tenant])).rejects.toMatchObject({code:'42501'});
  await expect(createOperationalEvent(db,{...createPayload,actor_id:i.user,request_id:randomUUID()})).rejects.toMatchObject({code:'42501'});
  await expect(resolveOperationalEvent(db,{...resolvePayload,actor_id:i.user,request_id:randomUUID()})).rejects.toMatchObject({code:'42501'});
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);
  await expect(operationRpc(db,'select get_operational_event_create_context($1,$2::jsonb)',[i.tenant,'{}'])).rejects.toMatchObject({code:'42501'});
 });

 it('resolves atomically, closes the public lifecycle and exactly replays a lost acknowledgement',async()=>{
  const created=await createOperationalEvent(db,await eventCreatePayload(db,defaultEventBindings(trip,stop)));
  const payload=await eventResolvePayload(db,created.event_id as string);const first=await resolveOperationalEvent(db,payload);
  expect(await resolveOperationalEvent(db,payload)).toEqual(first);
  expect((await db.query(`select resolution,resolved_at is not null resolved,public_status,client_action_required
    from operational_events where id=$1`,[created.event_id])).rows[0]).toEqual({
   resolution:'Tratativa validada e encerrada pela operação QA',resolved:true,public_status:'resolved',client_action_required:false,
  });
  expect((await db.query(`select count(*)::int n from operational_events where visible_to_client and
    (resolved_at is null or public_status<>'resolved' or client_action_required)`)).rows[0]).toEqual({n:0});
  await expect(ownerStatement(db,`insert into client_occurrence_messages(id,tenant_id,occurrence_id,author_role,message)
    values($1,$2,$3,'client','Resposta tardia do portal')`,[randomUUID(),i.tenant,created.event_id]))
   .rejects.toThrow('client_occurrence_message_lifecycle_closed');
  expect((await db.query("select count(*)::int n from operational_event_commands where action='resolve'")).rows[0]).toEqual({n:1});
  expect((await db.query("select count(*)::int n from entity_audit_log where source in('create_operational_event_v1','resolve_operational_event_v1')")).rows[0]).toEqual({n:2});
  await expect(resolveOperationalEvent(db,{...payload,resolution:'Outra resolução usando a mesma chave QA'})).rejects.toThrow('operational_event_request_key_mismatch');
 });

 it('lets only one competing resolution commit from the same expected revision',async()=>{
  const created=await createOperationalEvent(db,await eventCreatePayload(db,defaultEventBindings(trip,stop)));
  const base=await eventResolvePayload(db,created.event_id as string);const competing={...base,request_id:randomUUID(),resolution:'Segunda decisão concorrente da operação QA'};
  await expect(resolveOperationalEvent(db,base)).resolves.toMatchObject({confirmed:true});
  await expect(resolveOperationalEvent(db,competing)).rejects.toThrow(/context_changed|already_resolved|concurrent_change/);
  expect((await db.query("select count(*)::int n from operational_event_commands where action='resolve'")).rows[0]).toEqual({n:1});
 });

 it('includes portal messages in the revision and rejects a stale resolution',async()=>{
  const created=await createOperationalEvent(db,await eventCreatePayload(db,defaultEventBindings(trip,stop)));
  const payload=await eventResolvePayload(db,created.event_id as string);
  await db.query(`insert into client_occurrence_messages(id,tenant_id,occurrence_id,author_role,message)
    values($1,$2,$3,'client','Nova informação do cliente')`,[randomUUID(),i.tenant,created.event_id]);
  await expect(resolveOperationalEvent(db,payload)).rejects.toThrow('operational_event_context_changed');
  expect((await db.query('select resolved_at,public_status,client_action_required from operational_events where id=$1',[created.event_id])).rows[0])
   .toEqual({resolved_at:null,public_status:'open',client_action_required:true});
 });

 it('rolls back event closure if command persistence fails late and permits a clean retry',async()=>{
  const created=await createOperationalEvent(db,await eventCreatePayload(db,defaultEventBindings(trip,stop)));
  const payload=await eventResolvePayload(db,created.event_id as string);
  await db.exec(`create function public.qa_fail_resolve_command() returns trigger language plpgsql as $$begin
    if new.action='resolve' then raise exception 'qa_late_failure';end if;return new;end$$;
    create trigger qa_fail_resolve_command before insert on operational_event_commands for each row execute function qa_fail_resolve_command();`);
  await expect(resolveOperationalEvent(db,payload)).rejects.toThrow('qa_late_failure');
  expect((await db.query('select resolved_at,public_status,client_action_required from operational_events where id=$1',[created.event_id])).rows[0])
   .toEqual({resolved_at:null,public_status:'open',client_action_required:true});
  expect((await db.query("select count(*)::int n from operational_event_commands where action='resolve'")).rows[0]).toEqual({n:0});
  await db.exec('drop trigger qa_fail_resolve_command on operational_event_commands;drop function qa_fail_resolve_command()');
  await expect(resolveOperationalEvent(db,payload)).resolves.toMatchObject({confirmed:true,public_status:'resolved'});
 });

 it('normalizes a still-deployed direct resolution until the later frontend cutover',async()=>{
  const id=randomUUID();await db.query(`insert into operational_events(id,tenant_id,client_id,event_type,severity,description,
    created_at,updated_at,visible_to_client,client_action_required,client_opened,public_status)
    values($1,$2,$3,'other','medium','Ocorrência legada QA',now(),now(),true,true,false,'open')`,[id,i.tenant,i.client]);
  await db.query("update operational_events set resolved_at=now(),resolution='Resolvida pelo escritor legado QA' where id=$1",[id]);
  expect((await db.query('select public_status,client_action_required,resolved_at is not null resolved from operational_events where id=$1',[id])).rows[0])
   .toEqual({public_status:'resolved',client_action_required:false,resolved:true});
 });

 it('installs validated composite tenant FKs, least privilege and immutable command history',async()=>{
  const result=(await db.query<Record<string,boolean>>(`select
   has_function_privilege('authenticated','get_operator_pod_history_v1(uuid,uuid)','execute') pod,
   has_function_privilege('authenticated','create_operational_event_v1(jsonb)','execute') create_api,
   has_function_privilege('authenticated','resolve_operational_event_v1(jsonb)','execute') resolve_api,
   has_function_privilege('anon','create_operational_event_v1(jsonb)','execute') anon_api,
   has_function_privilege('service_role','resolve_operational_event_v1(jsonb)','execute') service_api,
   has_function_privilege('authenticated','_operational_event_binding_snapshot(uuid,jsonb,boolean)','execute') helper,
   has_table_privilege('authenticated','operational_event_commands','insert') direct_insert`)).rows[0];
  expect(result).toEqual({pod:true,create_api:true,resolve_api:true,anon_api:false,service_api:false,helper:false,direct_insert:false});
  expect((await db.query(`select count(*)::int n from pg_constraint where conrelid='operational_events'::regclass
    and conname like 'operational_events_%_tenant_fkey' and convalidated`)).rows[0]).toEqual({n:9});
  expect((await db.query(`select conname,convalidated from pg_constraint where conname in
    ('event_chat_event_scope_fkey','client_occurrence_message_event_scope_fkey') order by conname`)).rows).toEqual([
   {conname:'client_occurrence_message_event_scope_fkey',convalidated:true},
   {conname:'event_chat_event_scope_fkey',convalidated:true},
  ]);
  const created=await createOperationalEvent(db,await eventCreatePayload(db,defaultEventBindings(trip,stop)));
  await expect(db.query('update operational_event_commands set response=response where event_id=$1',[created.event_id])).rejects.toThrow('append_only');
 });

 it('refuses reapplication without revoking the legacy APIs in this migration',async()=>{
  await db.exec('savepoint migration_reapply');
  await expect(db.exec(operatorEventSql())).rejects.toThrow('already installed');
  await db.exec('rollback to savepoint migration_reapply;release savepoint migration_reapply');
  expect(operatorEventSql()).not.toMatch(/(?:drop function|revoke all on function) public\.(?:record_operational_event_with_status|delete_load_safely|delete_loads_safely|hold_load|unhold_load)/i);
 });
});
