// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {accept,catalog,command,confirmation,effects,id,seedWeightDatabase,setActor,
 setupWeightDatabase,sqlFile,weightMigration,weightRollback} from './helpers/tripCargoWeightPrecisionDatabase';

let db:PGlite;
beforeAll(async()=>{db=await setupWeightDatabase();},30000);
beforeEach(async()=>{await seedWeightDatabase(db);});
afterAll(async()=>{await db?.close();});
const confirm=async(weight:unknown,request=randomUUID())=>command(db,request,'confirm_cargo',await confirmation(db,weight));
const recorded=async()=> (await db.query<{raw:string;confirmed:string;source:string;scale:number}>(
 `select c.expected_weight_kg::text raw,c.confirmed_weight_kg::text confirmed,
 l.total_weight_kg::text source,scale(c.confirmed_weight_kg) scale from trip_cargo_load_checks c join loads l on l.id=c.load_id`)).rows[0];
const weightAudit=async()=> (await db.query<{value:{decimal_places:number;rounding:string;loads:Record<string,unknown>[]}}>(
 "select new_data->'weight_precision' value from audit_log where action='confirm_cargo'")).rows[0]?.value;

describe('two-place kg server contract through actual authenticated cargo RPC',()=>{
 it.each([
  ['7691.72607421875',7691.73,'7691.73'],['1.005',1.01,'1.01'],['2.675',2.68,'2.68'],
  ['9.995',10,'10.00'],['0.005',0.01,'0.01'],['1.004',1,'1.00'],
  ['1.0049999999999997',1,'1.00'],['0.004',0,'0.00'],['1e-7',0,'0.00'],
  ['1.00499999999999999',1.01,'1.01'],['0.00499999999999999999',0.01,'0.01'],['1e-1000',0,'0.00'],
  ['5e-324',0,'0.00'],['0',0,'0.00'],['42',42,'42.00'],['1.2',1.2,'1.20'],['7.69',7.69,'7.69'],
  ['90071992547409.9',90071992547409.9,'90071992547409.90'],
  ['90071992547409.91',90071992547409.9,'90071992547409.90'],
 ])('preserves origin %s and records decimal half-up %s',async(raw,confirmed,formatted)=>{
  await seedWeightDatabase(db,raw);await accept(db);const before=(await recorded()).raw;
  await confirm(confirmed);
  const row=await recorded();expect(row).toMatchObject({raw:before,source:before,confirmed:formatted,scale:2});
  expect(await weightAudit()).toMatchObject({decimal_places:2,rounding:'decimal_half_up',loads:[{
   load_id:id.load,expected_raw_kg:before,expected_rounded_kg:formatted,confirmed_kg:formatted,
  }]});
  expect((await db.query('select * from trip_cargo_divergences')).rows).toHaveLength(0);
 });

 it.each([7691.72607421875,1.005,2.675,9.995,0.005,1e-7])('refuses unreviewed manual precision %s atomically',async(weight)=>{
  await accept(db);const before=await effects(db);
  await expect(confirm(weight)).rejects.toThrow('trip_cargo_weight_precision_required');
  expect(await effects(db)).toEqual(before);
 });

 it.each([-1,-0.001,null,undefined,{},[],true,'1.25','NaN','Infinity',Number.NaN,Infinity,1e21])(
  'refuses invalid/unsafe numeric weight %s without partial checks/audit',async(weight)=>{
   await accept(db);const before=await effects(db);await expect(confirm(weight)).rejects.toThrow();
   expect(await effects(db)).toEqual(before);
  });

 it('compares rounded expected kg with existing strict >1kg divergence tolerance',async()=>{
  await seedWeightDatabase(db,'1.005');await accept(db);await confirm(2.01);
  expect((await db.query('select * from trip_cargo_divergences')).rows).toHaveLength(0);
  await seedWeightDatabase(db,'1.005');await accept(db);await confirm(2.02);
  expect((await db.query<{expected_value:string;observed_value:string}>(
   "select expected_value,observed_value from trip_cargo_divergences where divergence_kind='weight'")).rows)
   .toEqual([{expected_value:'1.005',observed_value:'2.02'}]);
 });

 it.each(['90071992547409.91','90071992547409.92'])('refuses direct JSON numeric %s when unsafe in the Number payload contract',async(weight)=>{
  await accept(db);const before=await effects(db);
  const payload=JSON.stringify(await confirmation(db,0)).replace('"weight_kg":0','"weight_kg":'+weight);
  await db.exec('set role authenticated');
  try{await expect(db.query('select public.driver_update_trip_cargo_v1($1,$2,$3,$4,$5::jsonb)',
   [id.tenant,id.trip,randomUUID(),'confirm_cargo',payload])).rejects.toThrow('trip_cargo_weight_invalid');}
  finally{await db.exec('reset role');}
  expect(await effects(db)).toEqual(before);
 });

 it('uses Number-compatible source decimals independently of caller floating-output settings',async()=>{
  await seedWeightDatabase(db,'1.00499999999999999');await accept(db);
  await db.exec('set extra_float_digits=-3');
  try{
   await confirm(2.01);expect((await db.query('select * from trip_cargo_divergences')).rows).toHaveLength(0);
   expect(await weightAudit()).toMatchObject({loads:[{expected_raw_kg:'1.00499999999999999',expected_received_decimal_kg:'1.005',expected_rounded_kg:'1.01'}]});
   expect((await db.query<{value:string}>("select current_setting('extra_float_digits') value")).rows[0].value).toBe('-3');
  }finally{await db.exec('reset extra_float_digits');}
 });

 it.each(['NaN','Infinity','1e21','1e999'])('refuses a source outside the frontend representation contract: %s',async(raw)=>{
  await seedWeightDatabase(db,raw);await accept(db);const before=await effects(db);
  await expect(confirm(0)).rejects.toThrow('trip_cargo_expected_weight_invalid');expect(await effects(db)).toEqual(before);
 });

 it('replays the exact command once and rejects a changed payload under the same UUID',async()=>{
  await accept(db);const request=randomUUID(),payload=await confirmation(db,100.25);
  const first=await command(db,request,'confirm_cargo',payload),before=await effects(db);
  expect(await command(db,request,'confirm_cargo',payload)).toEqual(first);expect(await effects(db)).toEqual(before);
  await expect(command(db,request,'confirm_cargo',{...payload,loads:[{...payload.loads[0],weight_kg:100.26}]}))
   .rejects.toThrow('trip_cargo_request_conflict');expect(await effects(db)).toEqual(before);
 });

 it('does not bypass attribution or tenant/actor checks even on a persisted replay',async()=>{
  await accept(db);const request=randomUUID(),payload=await confirmation(db,100);await command(db,request,'confirm_cargo',payload);
  const before=await effects(db);
  await setActor(db,id.operator);await expect(command(db,request,'confirm_cargo',payload)).rejects.toThrow('trip_cargo_not_authorized');
  await setActor(db,id.driverUser,'20000000-0000-4000-8000-000000000002');
  await expect(command(db,request,'confirm_cargo',payload)).rejects.toThrow('trip_cargo_not_authorized');
  await setActor(db);await db.exec('update drivers set active=false');
  await expect(command(db,request,'confirm_cargo',payload)).rejects.toThrow('trip_cargo_not_authorized');
  await db.exec('update drivers set active=true');expect(await effects(db)).toEqual(before);
 });

 it('keeps helper/anon grants and unchanged volume/pallet/photo/seal guards',async()=>{
  await accept(db);const before=await effects(db),payload=await confirmation(db,100);
  await expect(command(db,randomUUID(),'confirm_cargo',{...payload,evidence:[]})).rejects.toThrow('trip_cargo_loading_photos_required');
  await expect(command(db,randomUUID(),'confirm_cargo',{...payload,seal_not_applicable_reason:''})).rejects.toThrow('trip_cargo_seal_confirmation_required');
  await expect(command(db,randomUUID(),'confirm_cargo',{...payload,loads:[{...payload.loads[0],pallet_count:-1}]})).rejects.toThrow();
  expect(await effects(db)).toEqual(before);
  await db.exec('set role anon');
  try{await expect(db.query("select public.driver_update_trip_cargo_v1($1,$2,$3,'confirm_cargo',$4::jsonb)",
   [id.tenant,id.trip,randomUUID(),JSON.stringify(payload)])).rejects.toThrow('permission denied');}
  finally{await db.exec('reset role');}
  const grants=(await db.query<{private_allowed:boolean;anon_allowed:boolean}>(
   "select has_function_privilege('authenticated','private.driver_update_trip_cargo(uuid,uuid,uuid,text,jsonb)','execute') private_allowed,has_function_privilege('anon','public.driver_update_trip_cargo_v1(uuid,uuid,uuid,text,jsonb)','execute') anon_allowed")).rows[0];
  expect(grants).toEqual({private_allowed:false,anon_allowed:false});
 });

 it('rejects a foreign load and rolls back prior loop writes when the second load is invalid',async()=>{
  const second='81000000-0000-4000-8000-000000000002';
  await db.query('insert into loads select $1::uuid,tenant_id,total_volume_m3,total_pallet_count,total_weight_kg,supplier_manifest,distribution_manifest,shipment_manifest,origin_manifest,os_number,external_load_number,control_load_number from loads',[second]);
  await db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)',[id.tenant,id.trip,second]);
  await db.query("insert into fiscal_documents values('83000000-0000-4000-8000-000000000002',$1,$2,'NF-102',null,null,10)",[id.tenant,second]);
  await accept(db);const payload=await confirmation(db,100);payload.loads.push({...payload.loads[0],load_id:second,weight_kg:1.005});
  const before=await effects(db);await expect(command(db,randomUUID(),'confirm_cargo',payload)).rejects.toThrow('trip_cargo_weight_precision_required');
  expect(await effects(db)).toEqual(before);payload.loads[1].load_id='81000000-0000-4000-8000-000000000003';
  await expect(command(db,randomUUID(),'confirm_cargo',payload)).rejects.toThrow('trip_cargo_load_confirmation_invalid');
  expect(await effects(db)).toEqual(before);
 });
});

describe('guarded supplement and compatible return with preserved history',()=>{
 it('keeps new centesimal confirmations and normalization evidence across rollback and re-upgrade',async()=>{
  await seedWeightDatabase(db,'7691.72607421875');await accept(db);
  const request=randomUUID(),payload=await confirmation(db,7691.73);
  const result=await command(db,request,'confirm_cargo',payload),data=await effects(db),audit=await weightAudit();
  await db.exec(sqlFile(weightRollback));expect(await effects(db)).toEqual(data);expect(await weightAudit()).toEqual(audit);
  expect(await command(db,request,'confirm_cargo',payload)).toEqual(result);expect(await effects(db)).toEqual(data);
  await db.exec(sqlFile(weightMigration));expect(await command(db,request,'confirm_cargo',payload)).toEqual(result);
  expect(await recorded()).toMatchObject({raw:'7691.72607421875',confirmed:'7691.73',scale:2});
 });

 it('reproduces predecessor precision, preserves historical replay, upgrades without data backfill and returns exactly',async()=>{
  const isolated=await setupWeightDatabase(false);
  try{
   await seedWeightDatabase(isolated,'7691.72607421875');await accept(isolated);
   const request=randomUUID(),payload=await confirmation(isolated,7691.72607421875);
   const result=await command(isolated,request,'confirm_cargo',payload),data=await effects(isolated),before=await catalog(isolated);
   await isolated.exec(sqlFile(weightMigration));
   expect(await effects(isolated)).toEqual(data);expect(await command(isolated,request,'confirm_cargo',payload)).toEqual(result);
   expect(await effects(isolated)).toEqual(data);
   const changed=await catalog(isolated);
   expect(changed.map(row=>row.proname==='driver_update_trip_cargo'?{...row,prosrc:'',proconfig:[]}:row))
    .toEqual(before.map(row=>row.proname==='driver_update_trip_cargo'?{...row,prosrc:'',proconfig:[]}:row));
   expect(changed.find(row=>row.proname==='driver_update_trip_cargo')?.proconfig).toEqual(['search_path=""','extra_float_digits=3']);
   await isolated.exec(sqlFile(weightMigration));expect(await catalog(isolated)).toEqual(changed);
   await isolated.exec(sqlFile(weightRollback));expect(await catalog(isolated)).toEqual(before);expect(await effects(isolated)).toEqual(data);
   await isolated.exec(sqlFile(weightRollback));expect(await catalog(isolated)).toEqual(before);
   await isolated.exec(sqlFile(weightMigration));
   expect(await command(isolated,request,'confirm_cargo',payload)).toEqual(result);
  }finally{await isolated.close();}
 },30000);

 it.each(['body','acl','dependency'])('fails closed on %s drift without partial modification',async(kind)=>{
  await db.exec(sqlFile(weightRollback));
  try{
   if(kind==='body')await db.exec("comment on function private.driver_update_trip_cargo(uuid,uuid,uuid,text,jsonb) is 'test'; do $$declare d text;begin select pg_get_functiondef('private.driver_update_trip_cargo(uuid,uuid,uuid,text,jsonb)'::regprocedure) into d;execute replace(d,'v_hash:=','/*drift*/v_hash:=');end$$;");
   if(kind==='acl')await db.exec('grant execute on function private.driver_update_trip_cargo(uuid,uuid,uuid,text,jsonb) to authenticated');
   if(kind==='dependency')await db.exec("do $$declare d text;begin select pg_get_functiondef('public.driver_update_trip_cargo_v1(uuid,uuid,uuid,text,jsonb)'::regprocedure) into d;execute replace(d,'declare v_existing','declare /*drift*/ v_existing');end$$;");
   const drifted=await catalog(db);await expect(db.exec(sqlFile(weightMigration))).rejects.toThrow(/drift/);expect(await catalog(db)).toEqual(drifted);
  }finally{await db.close();db=await setupWeightDatabase();}
 },30000);

 it('rollback fails closed after a later function change',async()=>{
  await db.exec("do $$declare d text;begin select pg_get_functiondef('private.driver_update_trip_cargo(uuid,uuid,uuid,text,jsonb)'::regprocedure) into d;execute replace(d,'v_hash:=','/*later*/v_hash:=');end$$;");
  const before=await catalog(db);await expect(db.exec(sqlFile(weightRollback))).rejects.toThrow('trip_cargo_weight_predecessor_drift');
  expect(await catalog(db)).toEqual(before);await db.close();db=await setupWeightDatabase();
 });
});
