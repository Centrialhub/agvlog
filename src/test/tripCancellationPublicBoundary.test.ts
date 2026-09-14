// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {createTripCancellationDatabase,seedPlannedCancellationTrip} from './helpers/tripCancellationDatabase';
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
import {tripCancellationPreviewSchema,tripCancellationResultSchema} from '@/lib/controlTower/tripCancellation';
const boundary=readFileSync('supabase/migrations/20260914201830_planned_trip_cancellation_public_boundary.sql','utf8');
describe('trip cancellation public boundary',()=>{
 it('authenticates preview/write/replay; omits evidence and denies raw/anonymous access',async()=>{
  const db=await createTripCancellationDatabase();try{
   await db.exec(boundary);const s=await seedPlannedCancellationTrip(db);await db.exec('grant usage on schema private to authenticated;set role authenticated');
   const c=(await db.query<{v:{revision:string,can_execute:boolean,completed_cancellation:boolean,result:unknown,_evidence?:unknown}}>('select public.preview_dispatch_trip_cancellation($1,$2) v',[s.tenant,s.trip])).rows[0].v;
   expect(tripCancellationPreviewSchema.safeParse(c).success).toBe(true);expect(c._evidence).toBeUndefined();expect(c.can_execute).toBe(true);expect(c.completed_cancellation).toBe(false);
   const p={version:1,tenant_id:s.tenant,trip_id:s.trip,request_id:crypto.randomUUID(),expected_revision:c.revision,reason:'Cancelamento operacional confirmado'};
   const result=(await db.query<{v:unknown}>('select public.cancel_dispatch_trip($1) v',[p])).rows[0].v;
   expect((await db.query<{v:unknown}>('select public.cancel_dispatch_trip($1) v',[p])).rows[0].v).toEqual(result);
   const after=(await db.query<{v:{completed_cancellation:boolean,result:unknown}}> ('select public.preview_dispatch_trip_cancellation($1,$2) v',[s.tenant,s.trip])).rows[0].v;
   expect(tripCancellationResultSchema.safeParse(result).success).toBe(true);expect(tripCancellationPreviewSchema.safeParse(after).success).toBe(true);expect(after.completed_cancellation).toBe(true);expect(after.result).toEqual(result);
   await expect(db.query('select private.cancel_planned_dispatch_trip($1)',[p])).rejects.toMatchObject({code:'42501'});
   await db.exec('reset role;set role anon');await expect(db.query('select public.cancel_dispatch_trip($1)',[p])).rejects.toMatchObject({code:'42501'});
  }finally{await db.close();}
 });
 it('refuses a changed core guard before exposing any public function',async()=>{
  const db=await createTripCancellationDatabase();try{
   await db.exec("alter function private.guard_cancelled_trip_reference() set search_path=public");
   await expect(db.exec(boundary)).rejects.toThrow(/trip_cancellation_public_predecessor_changed/);
   expect((await db.query<{present:boolean}>("select to_regprocedure('public.cancel_dispatch_trip(jsonb)') is not null present")).rows[0].present).toBe(false);
  }finally{await db.close();}
 });
 it('rolls back the whole cancellation if central audit rejects the event',async()=>{
  const db=await createTripCancellationDatabase();try{
   await db.exec(boundary);const s=await seedPlannedCancellationTrip(db);
   const c=(await db.query<{v:{revision:string}}>('select public.preview_dispatch_trip_cancellation($1,$2) v',[s.tenant,s.trip])).rows[0].v;
   await db.exec("alter table entity_audit_log add constraint reject_test_cancellation check(action<>'cancel_planned_trip')");
   await expect(db.query('select public.cancel_dispatch_trip($1)',[{version:1,tenant_id:s.tenant,trip_id:s.trip,request_id:crypto.randomUUID(),expected_revision:c.revision,reason:'Prova de rollback do evento auditado'}])).rejects.toMatchObject({code:'23514'});
   expect((await db.query<{status:string}>('select status from dispatch_trips where id=$1',[s.trip])).rows[0].status).toBe('planned');
   expect((await db.query<{trip_id:string}>('select trip_id from loads where id=$1',[s.load])).rows[0].trip_id).toBe(s.trip);
   expect((await db.query('select * from private.dispatch_trip_cancellations')).rows).toHaveLength(0);
  }finally{await db.close();}
 });

});
