// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDeliveryDocument, createDeliveryDatabase, deliveryDetails, deliveryIds as i,
  deliveryMigration, deliveryCutoverMigration, deliverySchema, legacyDeliveryContracts,
  legacyDeliverySchema, recordDelivery, seedDelivery } from './helpers/deliveryDatabase';

const additive=readFileSync(`supabase/migrations/${deliveryMigration}`,'utf8');
const cutover=readFileSync(`supabase/migrations/${deliveryCutoverMigration}`,'utf8');
const restoreLegacy=readFileSync('docs/qa/DELIVERY-CUTOVER-RECOVERY-2026-08-30.sql','utf8');
const restoreAdditive=readFileSync('docs/qa/DELIVERY-ADDITIVE-RECOVERY-2026-08-30.sql','utf8');
let db:PGlite;
const apiSignature='public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)';
beforeAll(async()=>{db=await createDeliveryDatabase({cutover:false});},30000);
beforeEach(async()=>{
  await seedDelivery(db);
  await db.exec(legacyDeliverySchema);
  const exists=(await db.query<{name:string|null}>('select to_regprocedure($1)::text name',[apiSignature])).rows[0].name;
  if(!exists)await db.exec(additive);
  else await db.exec(`revoke all on function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text) from public,anon,authenticated,service_role;
    revoke all on function public.driver_record_delivery_note(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;`);
});
afterAll(async()=>{await db?.close();});

async function expectLegacyRestored(quarantined=false) {
  for(const contract of legacyDeliveryContracts){
    const actual=(await db.query<{hash:string;anon:boolean;authenticated:boolean;service_role:boolean}>(`select
      md5(replace(pg_get_functiondef($1::regprocedure),chr(13),'')) hash,has_function_privilege('anon',$1,'execute') anon,
      has_function_privilege('authenticated',$1,'execute') authenticated,
      has_function_privilege('service_role',$1,'execute') service_role`,[`public.${contract.signature}`])).rows[0];
    expect(actual).toEqual({hash:contract.definition_hash,anon:quarantined?false:contract.anon,
      authenticated:quarantined?false:contract.authenticated,service_role:quarantined?false:contract.service_role});
  }
}
async function evidence(){return (await db.query(`select
  (select jsonb_agg(to_jsonb(p) order by id) from public.proof_of_delivery p) proofs,
  (select jsonb_agg(to_jsonb(e) order by id) from public.dispatch_events e) events,
  (select jsonb_agg(to_jsonb(e) order by id) from public.operational_events e) occurrences,
  (select jsonb_agg(to_jsonb(l) order by id) from public.loads l) loads`)).rows[0];}
const alias=(doc:string|null=i.doc)=>db.query(`select public.finalize_driver_delivery($1,$2,$3,$4::text[],$5) result`,
  [i.stop,deliveryDetails.receiver_name,deliveryDetails.signature_path,deliveryDetails.photo_paths,doc]);

describe('delivery phased rollout and recovery',()=>{
  it('installs additive APIs without modifying any of the five existing bodies or grants',async()=>{
    await expectLegacyRestored();
    expect((await db.query<{exists:boolean}>('select to_regprocedure($1) is not null as exists',[apiSignature])).rows[0].exists).toBe(true);
  });
  it('uses non-definer internal helpers and denies all API roles direct execution',async()=>{
    const helpers=['_lock_delivery_trip_graph','_lock_driver_delivery_stop','_delivery_result_from_statuses','_derive_driver_delivery_result'];
    const rows=(await db.query<{proname:string;prosecdef:boolean;anon:boolean;authenticated:boolean;service:boolean}>(`select p.proname,p.prosecdef,
      has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,
      has_function_privilege('service_role',p.oid,'execute') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=any($1::text[])`,[helpers])).rows;
    expect(rows).toHaveLength(4);
    for(const row of rows)expect(row).toMatchObject({prosecdef:false,anon:false,authenticated:false,service:false});
  });
  it('keeps staged APIs unavailable to API roles until the atomic legacy cutover',async()=>{
    for(const role of ['anon','authenticated','service_role']){
      await db.exec(`set role ${role}`);await expect(recordDelivery(db)).rejects.toMatchObject({code:'42501'});
      await expect(db.query('select public.driver_record_delivery_note($1,$2,$3,$4)',
        [i.stop,'outros','{"notes":"Comunicação QA"}',i.request])).rejects.toMatchObject({code:'42501'});
      await db.exec('reset role');
    }
    await db.exec(cutover);await db.exec('set role authenticated');
    expect((await recordDelivery(db)).rows[0].result.replayed).toBe(false);
  });
  it('derives different load results through the new API even while the old aggregate is untouched',async()=>{
    await db.query(`insert into public.loads(id,tenant_id,trip_id,status) values($1,$2,$3,'in_transit')`,[i.load2,i.tenant,i.trip]);
    await db.query('insert into public.dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)',[i.tenant,i.trip,i.load2]);
    await addDeliveryDocument(db,i.doc2,i.item2,i.load2,i.stop);
    // Private pre-publication verification as the DB owner, with driver identity.
    await recordDelivery(db,'partial_delivery',{...deliveryDetails,returned_items:{[i.item2]:10},notes:'Documento 2 devolvido integralmente'});
    await db.exec('reset role');
    expect((await db.query('select id,status from public.loads order by id')).rows).toEqual([
      {id:i.load,status:'delivered'},{id:i.load2,status:'returned'}]);
    await expectLegacyRestored();
  });
  it('fails closed if an additive object already exists instead of overwriting it',async()=>{
    const probe=new PGlite();
    try{
      await probe.exec(deliverySchema+`create function public._lock_delivery_trip_graph(uuid,uuid) returns text language sql as $$select 'keep'::text$$;`);
      await expect(probe.exec(additive)).rejects.toThrow('Additive delivery object already exists');
      expect((await probe.query("select public._lock_delivery_trip_graph(null,null) value")).rows).toEqual([{value:'keep'}]);
    }finally{await probe.close();}
  });
  it.each(['outbound','cte',null])('rejects a %s document before any operational or fiscal result is written',async documentType=>{
    await db.query('update public.fiscal_documents set document_type=$1',[documentType]);
    const before=await evidence();
    await expect(recordDelivery(db,'failed',{notes:'Cliente ausente'})).rejects.toMatchObject({code:'23514'});
    expect(await evidence()).toEqual(before);
    expect((await db.query('select status from public.fiscal_documents')).rows).toEqual([{status:'in_transit'}]);
    expect((await db.query('select status from public.dispatch_stops')).rows).toEqual([{status:'arrived'}]);
  });
  it('rejects cutover before the additive APIs are present',async()=>{
    const probe=new PGlite();
    try{
      await probe.exec(deliverySchema+legacyDeliverySchema);
      await expect(probe.exec(cutover)).rejects.toThrow('Additive delivery APIs must be installed');
    }finally{await probe.close();}
  });
  it('rejects a drifted legacy contract without partially replacing other functions',async()=>{
    await db.exec(`create or replace function public.derive_trip_and_load_status_v1(p_tenant_id uuid,p_trip_id uuid)
      returns void language plpgsql as $$begin return;end;$$;`);
    await expect(db.exec(cutover)).rejects.toThrow('Legacy contract changed');
    const untouched=legacyDeliveryContracts.find(c=>c.signature.startsWith('driver_finalize_delivery('))!;
    expect((await db.query<{hash:string}>("select md5(replace(pg_get_functiondef($1::regprocedure),chr(13),'')) hash",[`public.${untouched.signature}`])).rows[0].hash).toBe(untouched.definition_hash);
  });
  it('retires the implicit aggregate/transition APIs, including service execution',async()=>{
    await db.exec(cutover);
    for(const role of ['anon','authenticated','service_role']){
      for(const signature of ['derive_trip_and_load_status_v1(uuid,uuid)','transition_stop_status_v1(uuid,uuid,text,uuid,text,text,jsonb)']){
        expect((await db.query<{allowed:boolean}>('select has_function_privilege($1,$2,$3) allowed',[role,`public.${signature}`,'execute'])).rows[0].allowed).toBe(false);
      }
    }
  });
  it('rejects drift in the staged private APIs before exposing them',async()=>{
    await db.exec(`begin;comment on function public._delivery_result_from_statuses(text[]) is 'QA';
      alter function public._delivery_result_from_statuses(text[]) security definer;`);
    await expect(db.exec(cutover)).rejects.toThrow('Staged API contract changed');
    await db.exec('rollback');await expectLegacyRestored();
    await db.exec('set role authenticated');await expect(recordDelivery(db)).rejects.toMatchObject({code:'42501'});
  });
  it('keeps the service-only alias usable for one explicitly matching document and replay',async()=>{
    await db.exec(cutover);await db.exec('set role service_role');
    const first=(await alias()).rows[0] as {result:Record<string,unknown>};
    expect((await alias()).rows[0]).toEqual({result:{...first.result,replayed:true}});
    await db.exec('reset role');
    expect((await db.query('select count(*)::int count from public.proof_of_delivery')).rows[0]).toEqual({count:1});
  });
  it('does not silently ignore a different document ID in the legacy alias',async()=>{
    await db.exec(cutover);const before=await evidence();
    await expect(alias(i.doc2)).rejects.toMatchObject({code:'22023'});expect(await evidence()).toEqual(before);
  });
  it('does not expand a document-specific alias call into a multi-document delivery',async()=>{
    await addDeliveryDocument(db,i.doc2,i.item2,i.load,i.stop);await db.exec(cutover);const before=await evidence();
    await expect(alias()).rejects.toMatchObject({code:'22023'});expect(await evidence()).toEqual(before);
  });
  it('does not broaden the alias to authenticated drivers or accept a service call without a driver identity',async()=>{
    await db.exec(cutover);await db.exec('set role authenticated');await expect(alias()).rejects.toMatchObject({code:'42501'});
    await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role service_role");
    await expect(alias()).rejects.toMatchObject({code:'42501'});
  });
  it('recovers both phases before new usage, preserving the pre-existing business state',async()=>{
    const before=await evidence();await db.exec(cutover);await db.exec(restoreLegacy);await expectLegacyRestored();
    await db.exec('set role authenticated');await expect(recordDelivery(db)).rejects.toMatchObject({code:'42501'});
    await db.exec('reset role');
    await db.exec(restoreAdditive);expect(await evidence()).toEqual(before);
    expect((await db.query<{name:string|null}>('select to_regprocedure($1)::text name',[apiSignature])).rows[0].name).toBeNull();
    expect((await db.query<{name:string|null}>("select to_regclass('public.dispatch_events_delivery_request_key_idx')::text name")).rows[0].name).toBeNull();
    await expectLegacyRestored();
  });
  it('refuses uninstalling additive APIs while cutover wrappers still depend on them',async()=>{
    await db.exec(cutover);await expect(db.exec(restoreAdditive)).rejects.toThrow('Restore/verify legacy contracts');
    expect((await db.query<{exists:boolean}>('select to_regprocedure($1) is not null as exists',[apiSignature])).rows[0].exists).toBe(true);
  });
  it('quarantines old and new writes after committed delivery while retaining exact proofs/history/index',async()=>{
    await db.exec(cutover);await recordDelivery(db);const before=await evidence();
    await db.exec(restoreLegacy);await expectLegacyRestored(true);
    await db.exec(restoreAdditive);expect(await evidence()).toEqual(before);await expectLegacyRestored(true);
    expect((await db.query<{exists:boolean}>("select to_regclass('public.dispatch_events_delivery_request_key_idx') is not null as exists")).rows[0].exists).toBe(true);
    await db.exec('set role authenticated');await expect(recordDelivery(db)).rejects.toMatchObject({code:'42501'});
  });
});
