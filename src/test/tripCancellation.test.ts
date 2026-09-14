// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {createTripCancellationDatabase,seedPlannedCancellationTrip} from './helpers/tripCancellationDatabase';
const tenant='20000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000001',trip='30000000-0000-4000-8000-000000000001',load='40000000-0000-4000-8000-000000000001';
describe('private planned trip cancellation candidate',()=>{
 it('preserves graph history, releases only current load mirror and replays once',async()=>{
  const db=await createTripCancellationDatabase();try{
   const catalog=await db.query("select p.oid::regprocedure::text signature,md5(replace(p.prosrc,E'\\r\\n',E'\\n')) source_md5,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in('dispatch_trip_cancellation_context','cancel_planned_dispatch_trip','guard_cancelled_trip_reference','guard_cancelled_trip_stop_reference','guard_cancelled_physical_journey','preserve_dispatch_trip_cancellation') order by p.proname");
   writeFileSync('docs/qa/trip-cancellation-core-catalog-2026-09-14.json',JSON.stringify(catalog.rows,null,2)+'\n');
   await db.exec(`begin;select set_config('request.jwt.claim.sub','${actor}',true);select set_config('test.tenant','${tenant}',true);
   insert into tenants values('${tenant}');insert into tenant_memberships values('${tenant}','${actor}',true,'admin');
   insert into dispatch_trips(id,tenant_id,status) values('${trip}','${tenant}','planned');
   insert into loads(id,tenant_id,status) values('${load}','${tenant}','ready');
   insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values('${tenant}','${trip}','${load}');
   insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status) values(gen_random_uuid(),'${tenant}','${trip}','pending');
   insert into physical_journeys(id,status) values('${trip}','planned');insert into physical_journey_trips values('${trip}','${trip}');`);
   const ctx=(await db.query<{v:{revision:string,can_execute:boolean}}> ('select private.dispatch_trip_cancellation_context($1,$2) v',[tenant,trip])).rows[0].v;
   expect(ctx.can_execute).toBe(true);
   const payload={version:1,tenant_id:tenant,trip_id:trip,request_id:crypto.randomUUID(),expected_revision:ctx.revision,reason:'Viagem planejada criada por engano'};
   const first=(await db.query<{v:unknown}>('select private.cancel_planned_dispatch_trip($1) v',[payload])).rows[0].v;
   expect((await db.query<{v:unknown}>('select private.cancel_planned_dispatch_trip($1) v',[payload])).rows[0].v).toEqual(first);
   await db.exec('set constraints all immediate');
   expect((await db.query<{status:string}>('select status from dispatch_trips')).rows[0].status).toBe('cancelled');
   expect((await db.query<{trip_id:string|null}>('select trip_id from loads')).rows[0].trip_id).toBeNull();
   expect((await db.query('select * from dispatch_trip_loads')).rows).toHaveLength(1);
   expect((await db.query('select * from entity_audit_log')).rows).toHaveLength(1);
   await db.exec('commit');
   await expect(db.query('insert into driver_expenses(tenant_id,dispatch_trip_id) values($1,$2)',[tenant,trip])).rejects.toMatchObject({code:'55000'});
  }finally{await db.close();}
 });
 it('blocks money, execution, fiscal evidence and a stale preview without changing trip',async()=>{
  const db=await createTripCancellationDatabase();try{
   const source=await seedPlannedCancellationTrip(db);
   const preview=async()=>(await db.query<{v:{revision:string,can_execute:boolean,blockers:Array<{code:string}>}}>('select private.dispatch_trip_cancellation_context($1,$2) v',[source.tenant,source.trip])).rows[0].v;
   const initial=await preview();
   await db.query('insert into payables(tenant_id,dispatch_trip_id) values($1,$2)',[source.tenant,source.trip]);
   expect((await preview()).blockers.some(x=>x.code==='payables')).toBe(true);
   await expect(db.query('select private.cancel_planned_dispatch_trip($1)',[{version:1,tenant_id:source.tenant,trip_id:source.trip,request_id:crypto.randomUUID(),expected_revision:initial.revision,reason:'Cancelamento com prévia antiga'}])).rejects.toMatchObject({code:'40001'});
   await db.query('delete from payables where dispatch_trip_id=$1',[source.trip]);
   await db.query("update dispatch_trips set status='in_transit',actual_start_at=now() where id=$1",[source.trip]);
   expect((await preview()).can_execute).toBe(false);
   await db.query("update dispatch_trips set status='planned',actual_start_at=null where id=$1",[source.trip]);
   await db.query("insert into fiscal_documents(id,tenant_id,load_id,document_type,status,cte_emitted_at) values(gen_random_uuid(),$1,$2,'inbound','authorized',now())",[source.tenant,source.load]);
   expect((await preview()).blockers.some(x=>x.code==='fiscal_review_required')).toBe(true);
   expect((await db.query('select * from private.dispatch_trip_cancellations')).rows).toHaveLength(0);
  }finally{await db.close();}
 });
 it('rejects another tenant and mixed driver/operator sessions before replay',async()=>{
  const db=await createTripCancellationDatabase();try{
   const source=await seedPlannedCancellationTrip(db);
   await expect(db.query('select private.dispatch_trip_cancellation_context($1,$2)',[crypto.randomUUID(),source.trip])).rejects.toMatchObject({code:'42501'});
   await db.query("insert into tenant_memberships values($1,$2,true,'driver')",[source.tenant,source.actor]);
   await expect(db.query('select private.dispatch_trip_cancellation_context($1,$2)',[source.tenant,source.trip])).rejects.toMatchObject({code:'42501'});
   expect((await db.query('select * from private.dispatch_trip_cancellations')).rows).toHaveLength(0);
  }finally{await db.close();}
 });

 it('retains inbound note provenance and permits the unchanged load in a new planned trip',async()=>{
  const db=await createTripCancellationDatabase();try{
   const source=await seedPlannedCancellationTrip(db),doc=crypto.randomUUID();
   await db.query("insert into fiscal_documents(id,tenant_id,load_id,document_type,status) values($1,$2,$3,'inbound','authorized')",[doc,source.tenant,source.load]);
   await db.query('insert into load_items values(gen_random_uuid(),$1,$2,$3)',[source.tenant,source.load,doc]);
   await db.query('insert into dispatch_stop_documents values(gen_random_uuid(),$1,$2,$3,$4)',[source.tenant,source.stop,doc,source.load]);
   const before=(await db.query('select * from fiscal_documents where id=$1',[doc])).rows;
   const ctx=(await db.query<{v:{revision:string}}>('select private.dispatch_trip_cancellation_context($1,$2) v',[source.tenant,source.trip])).rows[0].v;
   await db.query('select private.cancel_planned_dispatch_trip($1)',[{version:1,tenant_id:source.tenant,trip_id:source.trip,request_id:crypto.randomUUID(),expected_revision:ctx.revision,reason:'Viagem incorreta sem início físico'}]);
   const next=crypto.randomUUID(),stop=crypto.randomUUID();
   await db.query("insert into dispatch_trips(id,tenant_id,status) values($1,$2,'planned')",[next,source.tenant]);
   await db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)',[source.tenant,next,source.load]);
   await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status) values($1,$2,$3,'pending')",[stop,source.tenant,next]);
   await db.query('insert into dispatch_stop_documents values(gen_random_uuid(),$1,$2,$3,$4)',[source.tenant,stop,doc,source.load]);
   await db.query('select public._assert_load_replanning_graph($1,$2)',[source.tenant,[source.load]]);
   expect((await db.query('select * from fiscal_documents where id=$1',[doc])).rows).toEqual(before);
   expect((await db.query('select * from dispatch_stop_documents where fiscal_document_id=$1',[doc])).rows).toHaveLength(2);
  }finally{await db.close();}
 });

});
