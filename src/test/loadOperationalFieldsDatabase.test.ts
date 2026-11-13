// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {applyLoadCommand,createLoadAggregateDatabase,loadAggregateIds as i,loadCommand,seedLoad} from './helpers/loadAggregateDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createLoadAggregateDatabase();},40000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);await seedLoad(db);});
afterEach(async()=>{await db.exec('rollback;reset role');});
it('persists operational fields and before/after audit while preserving totals, status and delivery data',async()=>{
 const changes={actual_load_at:'2026-11-10T09:00:00Z',gate_departure_at:'2026-11-10T10:00:00Z',arrival_at:'2026-11-11T11:00:00Z',
  driver_type:'Agregado',monitor_responsible:'Operação QA',monitored:true,sm_manager:'Gerenciadora QA',sm_release:'Liberado QA'};
 const command=loadCommand('update',{load_id:i.load,expected_version:1,changes,reason:'Conferência operacional QA'});
 const result=await applyLoadCommand(db,command);expect(result).toMatchObject({version:2});
 const row=(await db.query<Record<string,unknown>>('select * from public.loads where id=$1',[i.load])).rows[0];
 expect(row).toMatchObject({driver_type:'Agregado',monitor_responsible:'Operação QA',monitored:true,sm_manager:'Gerenciadora QA',sm_release:'Liberado QA',status:'planned',trip_id:null,
  total_weight_kg:'0',total_volume_m3:'0',total_pallet_count:0});
 expect(new Date(row.arrival_at as string).toISOString()).toBe('2026-11-11T11:00:00.000Z');
 expect((await db.query<{n:number}>('select count(*)::int n from public.entity_audit_log')).rows[0].n).toBe(1);
 expect(await applyLoadCommand(db,command)).toMatchObject({replayed:true,version:2});
 await expect(applyLoadCommand(db,loadCommand('update',{load_id:i.load,expected_version:1,changes:{monitored:false}}))).rejects.toThrow('load_revision_conflict');
});
it('bumps revision for monitoring-only edits, rejects malformed values and protects note totals',async()=>{
 expect(await applyLoadCommand(db,loadCommand('update',{load_id:i.load,expected_version:1,changes:{monitored:true}}))).toMatchObject({version:2});
 for(const changes of [{monitored:'true'},{driver_type:{value:'QA'}},{arrival_at:'infinity'},{total_weight_kg:123}]){
  await db.exec('savepoint bad');
  await expect(applyLoadCommand(db,loadCommand('update',{load_id:i.load,expected_version:2,changes}))).rejects.toThrow();
  await db.exec('rollback to bad;release bad;reset role');
 }
});
it('keeps tenant/actor/route guards, permits audited operational edits in transit and supports forward replay',async()=>{
 await db.exec(readFileSync('supabase/migrations/20261112190322_editable_load_operational_fields.sql','utf8'));
 await db.exec('savepoint tenant');
 await expect(applyLoadCommand(db,{...loadCommand('update',{load_id:i.load,expected_version:1,changes:{monitored:true}}),tenant_id:i.otherTenant})).rejects.toThrow('operator_role_required');
 await db.exec('rollback to tenant;release tenant;reset role');
 await db.query("update public.loads set status='in_transit' where id=$1",[i.load]);
 const version=(await db.query<{version:number}>('select version from public.loads where id=$1',[i.load])).rows[0].version;
 expect(await applyLoadCommand(db,loadCommand('update',{load_id:i.load,expected_version:version,changes:{monitored:true}}))).toMatchObject({version:version+1});
 await expect(applyLoadCommand(db,loadCommand('update',{load_id:i.load,expected_version:version+1,changes:{destination:'Outra rota'}}))).rejects.toThrow('load_header_locked');
});
