// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {createTripCancellationPlanningDatabase} from './helpers/tripCancellationPlanningDatabase';
import {planningPayload,planningIds as i} from './helpers/planningDatabase';
async function dispatchPlanning(db:Awaited<ReturnType<typeof createTripCancellationPlanningDatabase>>,p=planningPayload()){
 const payload={...p,stops:p.stops.map(s=>({...s,location_source:'map_selected'}))};
 await db.exec('set role authenticated');try{return(await db.query<{trip:string}>('select public.dispatch_planned_route_v3($1) trip',[payload])).rows[0].trip;}finally{await db.exec('reset role');}
}
describe('planned cancellation and real planner graph',()=>{
 it('dispatches, cancels, then dispatches unchanged load and notes through existing planner RPC',async()=>{
  const db=await createTripCancellationPlanningDatabase();try{
   await db.query("select set_config('test.tenant',$1,false)",[i.tenant]);await db.query('insert into tenants values($1)',[i.tenant]);
   const first=await dispatchPlanning(db);await db.query("insert into physical_journeys(id,status) values($1,'planned')",[first]);await db.query('insert into physical_journey_trips values($1,$1)',[first]);
   const before=(await db.query('select * from fiscal_documents order by id')).rows;
   const ctx=(await db.query<{v:{can_execute:boolean,revision:string,blockers:unknown}}> ('select private.dispatch_trip_cancellation_context($1,$2) v',[i.tenant,first])).rows[0].v;
   expect(ctx.blockers).toEqual([]);expect(ctx.can_execute).toBe(true);
   await db.query('select private.cancel_planned_dispatch_trip($1)',[{version:1,tenant_id:i.tenant,trip_id:first,request_id:crypto.randomUUID(),expected_revision:ctx.revision,reason:'Viagem planejada duplicada por engano'}]);
   const payload=planningPayload();payload.idempotency_key=crypto.randomUUID();
   const second=await dispatchPlanning(db,payload);expect(second).not.toBe(first);
   await db.query('select public._assert_load_replanning_graph($1,$2)',[i.tenant,[i.load]]);
   expect((await db.query('select * from fiscal_documents order by id')).rows).toEqual(before);
   expect((await db.query<{trip_id:string}>('select trip_id from loads where id=$1',[i.load])).rows[0].trip_id).toBe(second);
   expect((await db.query<{status:string}>('select status from dispatch_trips where id=$1',[first])).rows[0].status).toBe('cancelled');
  }finally{await db.close();}
 });
});
