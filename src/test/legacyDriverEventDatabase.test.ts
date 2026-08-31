// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDeliveryDatabase, deliveryIds as i, seedDelivery } from './helpers/deliveryDatabase';

const read=(file:string)=>readFileSync(join(process.cwd(),file),'utf8');
const migration=read('supabase/migrations/20260830033306_restrict_legacy_driver_event_api.sql');
const recovery=read('docs/qa/LEGACY-DRIVER-EVENT-RECOVERY-2026-08-30.sql');
const contract=JSON.parse(read('docs/qa/LEGACY-DRIVER-EVENT-PREDEPLOYMENT-2026-08-30.json')) as {definition:string;definition_hash:string};
let db:PGlite;
beforeAll(async()=>{db=await createDeliveryDatabase();await db.exec(contract.definition);},30000);
beforeEach(async()=>{
  await seedDelivery(db);
  await db.exec(`revoke all on function public.driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text) from public,anon,authenticated,service_role;
    grant execute on function public.driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text) to authenticated,service_role;`);
});
afterAll(async()=>{await db?.close();});
const legacy=()=>db.query('select public.driver_report_event_v1($1,$2,$3,$4,$5,$6::jsonb,$7)',[i.driver,i.tenant,i.trip,i.stop,'end_shift','{}','qa-legacy']);
const apply=()=>db.exec(`begin;${migration}commit;`);

describe('legacy driver event API restriction',()=>{
  it('reproduces the old journey bypass and blocks it after the ACL migration',async()=>{
    await db.exec('set role authenticated');
    await expect(db.query('select public.driver_create_event($1,$2,$3::jsonb)',[i.trip,'end_shift','{}'])).rejects.toMatchObject({code:'23514'});
    await expect(legacy()).resolves.toHaveProperty('rows');
    await db.exec('reset role');await apply();await db.exec('set role authenticated');
    await expect(legacy()).rejects.toMatchObject({code:'42501'});
    await db.exec('reset role');
    expect((await db.query('select count(*)::int count from public.dispatch_events')).rows[0]).toEqual({count:1});
  });
  it('preserves trusted service access, function body and existing data',async()=>{
    await apply();
    expect((await db.query(`select md5(pg_get_functiondef('public.driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text)'::regprocedure)) hash,
      has_function_privilege('service_role','public.driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text)','execute') service,
      has_function_privilege('anon','public.driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text)','execute') anon`)).rows[0])
      .toEqual({hash:contract.definition_hash,service:true,anon:false});
    expect((await db.query('select status from public.dispatch_trips')).rows[0]).toEqual({status:'in_transit'});
  });
  it('leaves current driver event/occurrence APIs executable',async()=>{
    await apply();await db.exec('set role authenticated');
    await expect(db.query('select public.driver_create_event($1,$2,$3::jsonb)',[i.trip,'operational_note','{}'])).resolves.toHaveProperty('rows');
    await expect(db.query('select public.driver_create_operational_occurrence($1,$2,$3)',[i.trip,'other','QA local'])).resolves.toHaveProperty('rows');
  });
  it('rehearses explicit emergency ACL recovery without rewriting the definition',async()=>{
    await apply();await db.exec(recovery);
    expect((await db.query(`select has_function_privilege('authenticated',
      'public.driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text)','execute') allowed`)).rows[0]).toEqual({allowed:true});
  });
});
