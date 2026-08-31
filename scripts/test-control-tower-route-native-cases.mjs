import assert from 'node:assert/strict';
import {towerIds as i} from '../src/test/helpers/controlTowerDatabase.ts';

export async function runControlTowerRouteNative({run,reset,auth,root,contested,database,q,session,finish,waitForMarker}){
 const request='90000000-0000-4000-8000-000000000001',next='90000000-0000-4000-8000-000000000002',attempt='91000000-0000-4000-8000-000000000001';
 const payload=JSON.stringify({geometry:{type:'LineString',coordinates:[[-46.1,-23.1],[-46,-23]]},distance_meters:15000,duration_seconds:900,waypoints:[{location:[-46.1,-23.1]},{location:[-46,-23]}]});
 const prepare=(id=request)=>`select prepare_trip_route_v1(${q(i.tenant)},${q(i.trip)},${q(id)},${q(attempt)});`;
 const commit=(id=request,body=payload)=>`select commit_trip_route_v1(${q(i.tenant)},${q(i.trip)},${q(id)},${q(attempt)},${q(body)}::jsonb);`;
 const seed=async()=>{await reset();await run(`insert into positions_last(tenant_id,vehicle_id,lat,lng,speed,captured_at,received_at)
 values(${q(i.tenant)},${q(i.vehicle)},-23.1,-46.1,30,clock_timestamp()-interval '1 minute',clock_timestamp());${auth}${prepare()}`);};
 const counts=()=>run("select (select count(*) from trip_routes)||','||(select count(*) from control_tower_private.route_calculations where result is not null)");
 const tests=[
  ['route same-request concurrent replay writes one route and one receipt',async()=>{
   await seed();await contested(`${auth}${commit()}`,`${auth}${commit()}`,{database,driver:false});assert.equal(await counts(),'1,1');
  }],
  ['competing route calculations cannot overwrite the first committed revision',async()=>{
   await seed();await run(`${auth}${prepare(next)}`);
   const result=await contested(`${auth}${commit()}`,`${auth}${commit(next)}`,{database,driver:false,waiterSucceeds:false});
   assert.match(result.error,/PT409/);assert.equal(await counts(),'1,1');
  }],
  ...[
   ['stop changed',"update dispatch_stops set latitude=-22",/PT409/],
   ['position advanced',"update positions_last set lat=-22,captured_at=clock_timestamp()",/PT409/],
   ['trip completed',"update dispatch_trips set status='completed'",/PT409/],
   ['membership revoked','update tenant_memberships set active=false',/42501/],
   ['MFA requirement raised',"update tenant_memberships set role='admin'",/MFA required/],
  ].map(([label,mutation,pattern])=>[`route commit rechecks ${label} after root wait`,async()=>{
   await seed();const result=await contested(root,`${auth}${commit()}`,{database,driver:false,holderAfterBlocked:mutation,waiterSucceeds:false});
   assert.match(result.error,pattern);assert.equal(await counts(),'0,0');
  }]),
  ...['dispatch_stops','positions_last','trip_routes'].map(table=>[`route busy ${table} fails atomically and succeeds after retry`,async()=>{
   await seed();let id=request;
   if(table==='trip_routes'){await run(`${auth}${commit()}${prepare(next)}`);id=next;}
   const before=await counts();const holder=session('route-child-holder',database);
   holder.send(`begin;select 1 from ${table} for update;select '__ROUTE_CHILD_READY__';`);await waitForMarker(holder,'__ROUTE_CHILD_READY__');
   try{await assert.rejects(()=>run(`${auth}${commit(id)}`),/55P03/);assert.equal(await counts(),before);}
   finally{await finish(holder,'commit;');}
   await run(`${auth}${commit(id)}`);assert.equal(await counts(),table==='trip_routes'?'1,2':'1,1');
  }]),
  ['route financial trigger remains atomic and avoids settlement/trip lock inversion',async()=>{
   await seed();await run(`insert into driver_settlements(tenant_id,dispatch_trip_id,status,needs_recalculation) values(${q(i.tenant)},${q(i.trip)},'pending_review',false)`);
   const holder=session('route-settlement-holder',database);holder.send("begin;select 1 from driver_settlements for update;select '__FINANCE_READY__';");await waitForMarker(holder,'__FINANCE_READY__');
   try{await assert.rejects(()=>run(`${auth}${commit()}`),/55P03/);assert.equal(await counts(),'0,0');}
   finally{await finish(holder,'commit;');}
   await run(`${auth}${commit()}`);assert.equal(await run('select needs_recalculation from driver_settlements'),'t');
   assert.equal(await run('select count(*) from driver_settlement_events'),'1');await run(`${auth}${commit()}`);
   assert.equal(await run('select count(*) from driver_settlement_events'),'1');
  }],
  ['remaining navigation distance preserves the full planned financial estimate',async()=>{
   await reset();await run(`update dispatch_trips set status='planned',actual_start_at=null;
   insert into positions_last(tenant_id,vehicle_id,lat,lng,speed,captured_at,received_at) values(${q(i.tenant)},${q(i.vehicle)},-23.1,-46.1,30,clock_timestamp()-interval '1 minute',clock_timestamp());${auth}${prepare()}${commit()}`);
   const remaining=JSON.stringify({geometry:{type:'LineString',coordinates:[[-46.05,-23.05],[-46,-23]]},distance_meters:7600,duration_seconds:450,waypoints:[{location:[-46.05,-23.05]},{location:[-46,-23]}]});
   await run(`update dispatch_trips set status='in_transit',actual_start_at=clock_timestamp();update positions_last set lat=-23.05,lng=-46.05,captured_at=clock_timestamp();${auth}${prepare(next)}${commit(next,remaining)}`);
   assert.equal(await run('select distance_meters::int||\',\'||planned_distance_meters::int from trip_routes'),'7600,15000');
   await run("update dispatch_stops set status='completed'");assert.equal(await run(`select control_tower_private.settlement_route_km(${q(i.tenant)},${q(i.trip)})::int`),'15');
  }],
 ];
 for(const[name,test]of tests){await test();console.log('PASS '+name);}return tests.length;
}
