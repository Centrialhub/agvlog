import assert from 'node:assert/strict';
import {
  prepareSsxPositionDatabase, seedSsxPosition, ssxIds as i,
} from '../src/test/helpers/ssxPositionDatabase.ts';

// Independent database in the same disposable PostgreSQL 17 cluster. It never
// resolves application credentials or contacts SSX/production.
export async function runSsxPositionNative({query,contested,literal:q}) {
  const database='ssx_position_qa';
  await query(`create database ${database}`);
  const run=sql=>query(sql,database);
  const schema=[];
  await prepareSsxPositionDatabase({exec:async sql=>schema.push(sql)},false);
  await run(schema.join('\n'));
  const seed=[];
  await seedSsxPosition({query:async(sql,params=[])=>seed.push(
    sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1]))+';',
  )});
  await run(seed.join('\n'));

  const asService='set role service_role;';
  const received='2026-08-31T21:30:00.000Z';
  const position=(captured,hash,lat=-23.55)=>({
    captured_at:captured,lat,lng:-46.63,speed:null,heading:null,
    telemetry:{native_qa:true},provider_payload_hash:hash,
  });
  const commit=(positions,at=received)=>`${asService}select public.commit_ssx_position_batch_v1(
    ${q(i.tenant)},${q(i.account)},${q(i.unit)},${q(i.link)},${q(i.vehicle)},
    ${q(at)}::timestamptz,${q(JSON.stringify(positions))}::jsonb,'{"combo_source":"native_qa"}'::jsonb
  )`;
  const error=(at)=>`${asService}select public.record_ssx_poll_error_v1(
    ${q(i.tenant)},${q(i.account)},${q(i.unit)},${q(i.link)},${q(i.vehicle)},
    ${q(at)}::timestamptz,'provider_error',${q(at)}::timestamptz+interval '1 minute',
    ${q(JSON.stringify({native_error_at:at}))}::jsonb
  )`;
  const reset=()=>run(`truncate positions_raw,positions_last,ingestion_cursors,vehicle_processing_queue;
    delete from vehicle_tracker_links where id<>${q(i.link)};
    update vehicle_tracker_links set active=true,end_at=null,vehicle_id=${q(i.vehicle)},provider_unit_id=${q(i.unit)} where id=${q(i.link)};
    delete from tenant_feature_policy;
    insert into tenant_feature_policy(tenant_id,feature_key,enabled) values
      (${q(i.tenant)},'ssx_enabled',true),(${q(i.tenant)},'ssx_kill_switch',false);`);

  const tests=[
    ['simultaneous first positions serialize and keep a monotonic latest point',async()=>{
      await reset();
      const older=position('2026-08-31T21:20:00.000Z','native-first-old');
      const newer=position('2026-08-31T21:25:00.000Z','native-first-new',-23.54);
      await contested(commit([older]),commit([newer]),{database,driver:false});
      assert.equal(await run('select count(*) from positions_raw'),'2');
      assert.equal(await run("select captured_at='2026-08-31T21:25:00Z'::timestamptz from positions_last"),'t');
      assert.match(await run("select source->>'speed_source' from positions_last"),/computed|invalid_delta/);
    }],
    ['a binding changed while commit waits is rechecked before every write',async()=>{
      await reset();
      const holder=`select id from vehicle_tracker_links where id=${q(i.link)} for update`;
      const result=await contested(holder,commit([position('2026-08-31T21:25:00.000Z','native-remap')]),{
        database,driver:false,waiterSucceeds:false,
        holderAfterBlocked:`update vehicle_tracker_links set active=false,end_at=clock_timestamp() where id=${q(i.link)}`,
      });
      assert.match(result.error,/ssx_tracker_binding_changed/);
      assert.equal(await run('select count(*) from positions_raw'),'0');
    }],
    ['kill switch changed while commit waits is rechecked before every write',async()=>{
      await reset();
      const holder=`select tenant_id from tenant_feature_policy where tenant_id=${q(i.tenant)} and feature_key='ssx_kill_switch' for update`;
      const result=await contested(holder,commit([position('2026-08-31T21:25:00.000Z','native-kill')]),{
        database,driver:false,waiterSucceeds:false,
        holderAfterBlocked:`update tenant_feature_policy set enabled=true where tenant_id=${q(i.tenant)} and feature_key='ssx_kill_switch'`,
      });
      assert.match(result.error,/integration_capability_disabled/);
      assert.equal(await run('select count(*) from positions_raw'),'0');
    }],
    ['two concurrent active bindings cannot claim the same unit or vehicle',async()=>{
      await reset();
      await run(`update vehicle_tracker_links set active=false,end_at=clock_timestamp() where id=${q(i.link)}`);
      const first='24000000-0000-4000-8000-000000000091';
      const second='24000000-0000-4000-8000-000000000092';
      const insert=id=>`insert into vehicle_tracker_links(id,tenant_id,vehicle_id,provider_unit_id,active,start_at)
        values(${q(id)},${q(i.tenant)},${q(i.vehicle)},${q(i.unit)},true,clock_timestamp())`;
      const result=await contested(insert(first),insert(second),{
        database,driver:false,waiterSucceeds:false,
      });
      assert.match(result.error,/duplicate key|uq_ssx_active_link/i);
      assert.equal(await run('select count(*) from vehicle_tracker_links where active'),'1');
    }],
    ['an older success cannot erase a newer error committed while it waits',async()=>{
      await reset();
      const newer='2026-08-31T21:28:00.000Z';
      const older='2026-08-31T21:26:00.000Z';
      await contested(error(newer),commit([position('2026-08-31T21:24:00.000Z','native-old-success')],older),{
        database,driver:false,
      });
      assert.equal(await run("select last_error||','||(last_polled_at='2026-08-31T21:28:00Z'::timestamptz) from ingestion_cursors"),'provider_error,true');
    }],
    ['a failure after raw insertion rolls back raw, latest, queue and cursor',async()=>{
      await reset();
      await run(`create function qa_fail_latest() returns trigger language plpgsql as $$begin raise exception 'QA fail after raw';end$$;
        create trigger qa_fail_latest before insert on positions_last for each row execute function qa_fail_latest();`);
      await assert.rejects(()=>run(commit([position('2026-08-31T21:25:00.000Z','native-rollback')])),/QA fail after raw/);
      assert.equal(await run(`select (select count(*) from positions_raw)||','||(select count(*) from positions_last)||','||
        (select count(*) from vehicle_processing_queue)||','||(select count(*) from ingestion_cursors)`),'0,0,0,0');
      await run('drop trigger qa_fail_latest on positions_last;drop function qa_fail_latest()');
    }],
  ];
  for(const [name,test] of tests){await test();console.log('PASS '+name);}
  return tests.length;
}
