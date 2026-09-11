// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';

const migration=readFileSync('supabase/migrations/20260910134820_enforce_one_running_trip_per_driver.sql','utf8');
const tenant='20000000-0000-4000-8000-000000000001',driver='60000000-0000-4000-8000-000000000001';
let db:PGlite;
beforeEach(async()=>{db=new PGlite();await db.exec('create table dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,status text)');});
afterEach(async()=>db?.close());

describe('one running trip per driver',()=>{
  it('allows multiple future plans but rejects a second running trip',async()=>{
    await db.query("insert into dispatch_trips values(gen_random_uuid(),$1,$2,'planned'),(gen_random_uuid(),$1,$2,'dispatched'),(gen_random_uuid(),$1,$2,'in_transit')",[tenant,driver]);
    await db.exec(migration);
    await expect(db.query("insert into dispatch_trips values(gen_random_uuid(),$1,$2,'in_progress')",[tenant,driver]))
      .rejects.toMatchObject({code:'23505'});
    await expect(db.query("insert into dispatch_trips values(gen_random_uuid(),$1,$2,'planned')",[tenant,driver])).resolves.toBeTruthy();
  });
  it('fails closed with remediation context when legacy data is ambiguous',async()=>{
    await db.query("insert into dispatch_trips values(gen_random_uuid(),$1,$2,'in_transit'),(gen_random_uuid(),$1,$2,'in_progress')",[tenant,driver]);
    await expect(db.exec(migration)).rejects.toThrow('running_trip_conflict');
  });
});
