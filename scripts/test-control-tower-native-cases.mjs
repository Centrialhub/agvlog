import assert from 'node:assert/strict';
import {prepareControlTowerDatabase,seedTower,towerIds as i} from '../src/test/helpers/controlTowerDatabase.ts';
import {runControlTowerRouteNative} from './test-control-tower-route-native-cases.mjs';

// Independent database in the same disposable cluster. No production endpoint.
export async function runControlTowerNative({query,contested,literal:q,session,finish,waitForMarker}) {
 const database='control_tower_qa';await query(`create database ${database}`);
 const run=sql=>query(sql,database);
 const schema=[];await prepareControlTowerDatabase({exec:async sql=>schema.push(sql)},true,false);await run(schema.join('\n'));
 const seed=[];await seedTower({query:async(sql,params=[])=>seed.push(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1]))+';')});await run(seed.join('\n'));
 const auth=`set request.jwt.claim.sub=${q(i.actor)};set request.jwt.claims='{"aal":"aal1"}';set role authenticated;`;
 const evaluation=`select evaluate_trip_live_status_v1(${q(i.tenant)},${q(i.trip)})`;
 const root=`select id from dispatch_trips where id=${q(i.trip)} for update`;
 const race=(holder,after='',success=true)=>contested(holder,`${auth}${evaluation}`,{database,driver:false,holderAfterBlocked:after,waiterSucceeds:success});
 const reset=async()=>run(`truncate trip_alerts,trip_live_status,positions_last,positions_raw,trip_routes,control_tower_private.route_calculations,driver_settlements,driver_settlement_events;
   update tenant_memberships set active=true,role='operator';update tenant_feature_policy set enabled=true;
   delete from tenant_feature_policy where feature_key='ssx_kill_switch';
   update dispatch_trips set status='in_transit',vehicle_id=${q(i.vehicle)} where id=${q(i.trip)};
   update dispatch_stops set status='pending',latitude=-23,longitude=-46;`);
 const count=()=>run("select (select count(*) from trip_live_status)||','||(select count(*) from trip_alerts)");
 const tests=[
  ['concurrent evaluations serialize and preserve a single open alert ID',async()=>{
   await reset();await race(`${auth}${evaluation}`);assert.equal(await count(),'1,1');
   const id=await run('select id from trip_alerts');await run(`${auth}${evaluation}`);assert.equal(await run('select id from trip_alerts'),id);
  }],
  ['membership revoked while waiting causes denial and no writes',async()=>{
   await reset();const result=await race(root,'update tenant_memberships set active=false',false);assert.match(result.error,/42501/);assert.equal(await count(),'0,0');
  }],
  ['promotion to admin during wait requires fresh AAL2',async()=>{
   await reset();const result=await race(root,"update tenant_memberships set role='admin'",false);assert.match(result.error,/MFA required/);assert.equal(await count(),'0,0');
  }],
  ['SSX disabled during root wait prevents evaluation',async()=>{
   await reset();const result=await race(root,'update tenant_feature_policy set enabled=false',false);assert.match(result.error,/SSX disabled/);assert.equal(await count(),'0,0');
  }],
  ['kill-switch inserted during root wait prevents evaluation',async()=>{
   await reset();const result=await race(root,`insert into tenant_feature_policy(tenant_id,feature_key,enabled) values(${q(i.tenant)},'ssx_kill_switch',true)`,false);
   assert.match(result.error,/SSX disabled/);assert.equal(await count(),'0,0');
  }],
  ['completed trip during wait is skipped, never reported in transit',async()=>{
   await reset();const result=await race(root,"update dispatch_trips set status='completed'");assert.match(result.output,/"evaluated": false/);assert.equal(await count(),'0,0');
  }],
  ['vehicle and stop changed during wait are reread before calculation',async()=>{
   await reset();const other='50000000-0000-4000-8000-000000000088';await run(`insert into vehicles(id,tenant_id,plate) values(${q(other)},${q(i.tenant)},'QA-8888')`);
   await race(root,`update dispatch_trips set vehicle_id=${q(other)} where id=${q(i.trip)};update dispatch_stops set status='delivered'`);
   assert.equal(await run('select vehicle_id from trip_live_status'),other);assert.equal(await run('select next_stop_id is null from trip_live_status'),'t');
  }],
  ['failed alert insert rolls back status and previous alert closure',async()=>{
   await reset();await run(`insert into trip_alerts(tenant_id,trip_id,type,severity,title) values(${q(i.tenant)},${q(i.trip)},'off_route','critical','Anterior');
     create function qa_fail_alert() returns trigger language plpgsql as $$begin raise exception 'QA fail';end$$;
     create trigger qa_fail_alert before insert on trip_alerts for each row execute function qa_fail_alert();`);
   await assert.rejects(()=>run(`${auth}${evaluation}`),/QA fail/);assert.equal(await count(),'0,1');assert.equal(await run('select status from trip_alerts'),'open');
   await run('drop trigger qa_fail_alert on trip_alerts;drop function qa_fail_alert()');
  }],
  ...['dispatch_stops','positions_last','trip_routes'].map(table=>[
   `busy ${table} fails without partial writes or child/root deadlock, then retry succeeds`,async()=>{
    await reset();
    await run(`insert into positions_last(tenant_id,vehicle_id,lat,lng,speed,captured_at,received_at) values(${q(i.tenant)},${q(i.vehicle)},0,0.5,30,clock_timestamp()-interval '1 minute',clock_timestamp());
      insert into trip_routes(tenant_id,trip_id,provider,geometry_geojson,plan_revision) values(${q(i.tenant)},${q(i.trip)},'osrm','{"type":"LineString","coordinates":[[0,0],[1,0]]}',control_tower_private.route_plan_revision(${q(i.tenant)},${q(i.trip)}));`);
    const holder=session('tower-child-holder',database);holder.send(`begin;select 1 from ${table} for update;select '__CHILD_READY__';`);await waitForMarker(holder,'__CHILD_READY__');
    try{await assert.rejects(()=>run(`${auth}${evaluation}`),/55P03/);assert.equal(await count(),'0,0');}
    finally{await finish(holder,'commit;');}
    await run(`${auth}${evaluation}`);assert.equal(await run('select state from trip_live_status'),'normal');
   }
  ]),
 ];
 for(const[name,test]of tests){await test();console.log('PASS '+name);}
 return tests.length+await runControlTowerRouteNative({run,reset,auth,root,contested,database,q,session,finish,waitForMarker});
}
