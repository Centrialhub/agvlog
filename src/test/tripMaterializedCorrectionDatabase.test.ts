// @vitest-environment node
import {afterEach,describe,it,expect} from 'vitest';
import {createTripMaterializedCorrectionDatabase,seedMaterializedCorrectionTrip} from './helpers/tripMaterializedCorrectionDatabase';
const opened:Array<Awaited<ReturnType<typeof createTripMaterializedCorrectionDatabase>>>=[];
afterEach(async()=>{for(const db of opened.splice(0))await db.close();});
async function setup(){const db=await createTripMaterializedCorrectionDatabase();opened.push(db);return {db,source:await seedMaterializedCorrectionTrip(db)};}
describe('audited correction of materialized trips',()=>{
 it('retires only the trip and pending stops while preserving physical, load, financial and fiscal history',async()=>{
  const {db,source}=await setup(),payable=crypto.randomUUID(),doc=crypto.randomUUID();
  await db.query('insert into payables(id,tenant_id,dispatch_trip_id) values($1,$2,$3)',[payable,source.tenant,source.trip]);
  await db.query("insert into fiscal_documents(id,tenant_id,load_id,document_type,status,cte_emitted_at) values($1,$2,$3,'inbound','authorized','2026-09-14T11:00:00Z')",[doc,source.tenant,source.load]);
  const beforeDoc=(await db.query('select * from fiscal_documents where id=$1',[doc])).rows[0];
  const boundary=(await db.query<{schema:string;name:string;definer:boolean;authenticated:boolean;anon:boolean}>(`
   select n.nspname schema,p.proname name,p.prosecdef definer,
    has_function_privilege('authenticated',p.oid,'execute') authenticated,
    has_function_privilege('anon',p.oid,'execute') anon
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where p.proname in('preview_dispatch_trip_correction','correct_dispatch_trip',
    'dispatch_trip_correction_preview','dispatch_trip_correction_apply',
    'dispatch_trip_correction_context','correct_materialized_dispatch_trip')
   order by n.nspname,p.proname
  `)).rows;
  expect(boundary).toHaveLength(6);
  for(const fn of boundary){
   expect(fn.anon).toBe(false);
   if(fn.schema==='public')expect(fn).toMatchObject({definer:false,authenticated:true});
   else if(fn.name.endsWith('_preview')||fn.name.endsWith('_apply'))expect(fn).toMatchObject({definer:true,authenticated:true});
   else expect(fn).toMatchObject({definer:true,authenticated:false});
  }
  await db.exec('set role authenticated');
  const preview=(await db.query<{v:{revision:string;can_execute:boolean;dependency_counts:Array<{code:string}>;_evidence?:unknown}}>('select preview_dispatch_trip_correction($1,$2) v',[source.tenant,source.trip])).rows[0].v;
  expect(preview.can_execute).toBe(true);expect(preview.dependency_counts.some(x=>x.code==='payables')).toBe(true);expect(preview._evidence).toBeUndefined();
  const payload={version:1,tenant_id:source.tenant,trip_id:source.trip,request_id:crypto.randomUUID(),expected_revision:preview.revision,reason:'Viagem materializada por planejamento operacional incorreto',preserve_history_confirmed:true,fiscal_financial_unchanged_confirmed:true};
  const result=(await db.query<{v:unknown}>('select correct_dispatch_trip($1) v',[payload])).rows[0].v;
  expect((await db.query<{v:unknown}>('select correct_dispatch_trip($1) v',[payload])).rows[0].v).toEqual(result);
  await expect(db.query('select correct_dispatch_trip($1) v',[{...payload,reason:'Mesmo pedido com conteúdo divergente'}])).rejects.toMatchObject({code:'22023'});
  await db.exec('reset role');
  expect((await db.query<{status:string;actual_start_at:string|null}>('select status,actual_start_at from dispatch_trips where id=$1',[source.trip])).rows[0]).toMatchObject({status:'cancelled',actual_start_at:expect.anything()});
  expect((await db.query<{id:string;status:string}>('select id,status from dispatch_stops where dispatch_trip_id=$1 order by id',[source.trip])).rows).toEqual(expect.arrayContaining([{id:source.stop,status:'cancelled'},{id:source.completed,status:'completed'}]));
  expect((await db.query<{trip_id:string}>('select trip_id from loads where id=$1',[source.load])).rows[0].trip_id).toBe(source.trip);
  expect((await db.query('select * from dispatch_trip_loads where dispatch_trip_id=$1',[source.trip])).rows).toHaveLength(1);
  expect((await db.query('select * from payables where id=$1',[payable])).rows).toHaveLength(1);expect((await db.query('select * from fiscal_documents where id=$1',[doc])).rows[0]).toEqual(beforeDoc);
  expect((await db.query<{action:string;source:string}>('select action,source from entity_audit_log')).rows).toContainEqual({action:'correct_materialized_trip',source:'audited_materialized_trip_correction'});
  const snapshot=(await db.query<{before_snapshot:{trip:{id:string};dependency_counts:Array<{code:string}>}}>('select before_snapshot from private.dispatch_trip_corrections')).rows[0].before_snapshot;expect(snapshot.trip.id).toBe(source.trip);expect(snapshot.dependency_counts).toEqual(expect.arrayContaining([expect.objectContaining({code:'payables'})]));
  expect((await db.query<{status:string}>('select status from physical_journeys where id=$1',[source.trip])).rows[0].status).toBe('planned');
 });
 it('rejects stale previews, wrong tenant, driver sessions and a clean planned trip',async()=>{
  const {db,source}=await setup();await db.exec('set role authenticated');
  const preview=(await db.query<{v:{revision:string}}>('select preview_dispatch_trip_correction($1,$2) v',[source.tenant,source.trip])).rows[0].v;
  await db.exec('reset role');await db.query('insert into payables(tenant_id,dispatch_trip_id) values($1,$2)',[source.tenant,source.trip]);await db.exec('set role authenticated');
  const payload={version:1,tenant_id:source.tenant,trip_id:source.trip,request_id:crypto.randomUUID(),expected_revision:preview.revision,reason:'Prévia ficou antiga após materialização financeira',preserve_history_confirmed:true,fiscal_financial_unchanged_confirmed:true};
  await expect(db.query('select correct_dispatch_trip($1)',[payload])).rejects.toMatchObject({code:'40001'});
  await expect(db.query('select preview_dispatch_trip_correction($1,$2)',[crypto.randomUUID(),source.trip])).rejects.toMatchObject({code:'42501'});
  await db.exec('reset role');await db.query("insert into tenant_memberships values($1,$2,true,'driver')",[source.tenant,source.actor]);await db.exec('set role authenticated');
  await expect(db.query('select preview_dispatch_trip_correction($1,$2)',[source.tenant,source.trip])).rejects.toMatchObject({code:'42501'});
  await expect(db.query('select private.dispatch_trip_correction_context($1,$2)',[source.tenant,source.trip])).rejects.toMatchObject({code:'42501'});
  await expect(db.query('select * from private.dispatch_trip_corrections')).rejects.toMatchObject({code:'42501'});
  await db.exec('reset role');await db.query("delete from tenant_memberships where role='driver'");const clean=await (await import('./helpers/tripCancellationDatabase')).seedPlannedCancellationTrip(db);await db.exec('set role authenticated');
  expect((await db.query<{v:{can_execute:boolean;clean_planned_trip:boolean}}>('select preview_dispatch_trip_correction($1,$2) v',[clean.tenant,clean.trip])).rows[0].v).toMatchObject({can_execute:false,clean_planned_trip:true});
  await db.exec('reset role;set role anon');await expect(db.query('select preview_dispatch_trip_correction($1,$2)',[clean.tenant,clean.trip])).rejects.toMatchObject({code:'42501'});
 });
 it('keeps the correction and graph immutable, but permits non-link financial corrections',async()=>{
  const {db,source}=await setup(),payable=crypto.randomUUID();await db.query('insert into payables(id,tenant_id,dispatch_trip_id) values($1,$2,$3)',[payable,source.tenant,source.trip]);await db.exec('set role authenticated');
  const preview=(await db.query<{v:{revision:string}}>('select preview_dispatch_trip_correction($1,$2) v',[source.tenant,source.trip])).rows[0].v;
  await db.query('select correct_dispatch_trip($1)',[{version:1,tenant_id:source.tenant,trip_id:source.trip,request_id:crypto.randomUUID(),expected_revision:preview.revision,reason:'Encerramento corretivo com histórico preservado',preserve_history_confirmed:true,fiscal_financial_unchanged_confirmed:true}]);
  await db.exec('reset role');
  await expect(db.query('delete from payables where id=$1',[payable])).rejects.toMatchObject({code:'55000'});
  await db.query('update payables set tenant_id=tenant_id where id=$1',[payable]);
  await expect(db.query('update dispatch_trips set status=$1 where id=$2',['planned',source.trip])).rejects.toMatchObject({code:'55000'});
  await expect(db.query('delete from private.dispatch_trip_corrections')).rejects.toMatchObject({code:'55000'});
 });
 it('rolls back trip and journal if the audit event cannot be persisted',async()=>{
  const {db,source}=await setup();await db.exec("alter table entity_audit_log add constraint reject_materialized_correction check(action<>'correct_materialized_trip');set role authenticated");
  const preview=(await db.query<{v:{revision:string}}>('select preview_dispatch_trip_correction($1,$2) v',[source.tenant,source.trip])).rows[0].v;
  await expect(db.query('select correct_dispatch_trip($1)',[{version:1,tenant_id:source.tenant,trip_id:source.trip,request_id:crypto.randomUUID(),expected_revision:preview.revision,reason:'Prova de rollback integral da correção auditada',preserve_history_confirmed:true,fiscal_financial_unchanged_confirmed:true}])).rejects.toMatchObject({code:'23514'});
  await db.exec('reset role');expect((await db.query<{status:string}>('select status from dispatch_trips where id=$1',[source.trip])).rows[0].status).toBe('in_transit');expect((await db.query('select * from private.dispatch_trip_corrections')).rows).toHaveLength(0);
 });
});
