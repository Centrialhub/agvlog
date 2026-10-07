// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { accountCooldown, contractSnapshot, fixture, forwardSql, rollbackSql, ssxIds as i, unitBackoff } from './helpers/ssxAccountCooldownContractFixture';
let db:PGlite;
afterEach(async()=>{await db?.close();});
describe('real SSX SQL bounded retry contract',()=>{
  it('reproduces predecessor failure above one hour then accepts two hours without changing function identity or ACL',async()=>{
    db=await fixture(false);const before=await contractSnapshot(db);
    await expect(accountCooldown(db,7200)).rejects.toMatchObject({code:'22023'});
    await db.exec(forwardSql());const after=await contractSnapshot(db);
    expect(after.map(({body_hash:_hash,...rest})=>rest)).toEqual(before.map(({body_hash:_hash,...rest})=>rest));
    expect(await accountCooldown(db,7200)).toMatchObject({version:1,tenant_id:i.tenant,integration_account_id:i.account});
    await unitBackoff(db,7200);
    const state=(await db.query<{backoff_until:Date|null;last_success_at:Date|null}>('select backoff_until,last_success_at from ingestion_cursors where provider_unit_id=$1',[i.unit])).rows[0];
    expect(Date.parse(String(state.backoff_until))-Date.now()).toBeGreaterThan(7100000);
    const post=await contractSnapshot(db);await db.exec(forwardSql());expect(await contractSnapshot(db)).toEqual(post);
  });
  it.each([3601,7200,86400])('accepts elapsed %s seconds for account and unit',async seconds=>{
    db=await fixture();const observed=new Date().toISOString();
    const receipt=await accountCooldown(db,seconds,observed);await unitBackoff(db,seconds,observed);
    expect(Date.parse(String(receipt.cooldown_until))-Date.parse(observed)).toBe(seconds*1000);
  });
  it.each(['UTC','America/New_York'])('enforces elapsed 24h across spring/fall DST in %s',async zone=>{
    db=await fixture();await db.exec(`set timezone='${zone}'`);
    for(const observed of ['2026-03-08T06:30:00Z','2025-11-02T05:30:00Z']){
      await accountCooldown(db,86400,observed);await unitBackoff(db,86400,observed);
      await expect(accountCooldown(db,86400.001,observed)).rejects.toMatchObject({code:'22023'});
      await expect(unitBackoff(db,86400.001,observed)).rejects.toMatchObject({code:'22023'});
    }
  });
  it.each(['infinity','-infinity','2026-10-06T00:00:00Z'])('rejects invalid/excessive/reversed timestamp %s without changing data',async until=>{
    db=await fixture();const before=(await db.query('select poll_cooldown_until from integration_accounts where id=$1',[i.account])).rows;
    await expect(db.query('select public.record_ssx_account_cooldown_v1($1,$2,clock_timestamp(),$3,$4)',[i.tenant,i.account,until,'QA'])).rejects.toMatchObject({code:'22023'});
    expect((await db.query('select poll_cooldown_until from integration_accounts where id=$1',[i.account])).rows).toEqual(before);
  });
  it('rejects above24h/future observation/empty error, other tenant and disabled capability',async()=>{
    db=await fixture();await expect(accountCooldown(db,86401)).rejects.toMatchObject({code:'22023'});
    await expect(accountCooldown(db,120,new Date(Date.now()+360000).toISOString())).rejects.toMatchObject({code:'22023'});
    await expect(accountCooldown(db,120,undefined,i.otherTenant)).rejects.toMatchObject({code:'22023'});
    await expect(db.query('select public.record_ssx_account_cooldown_v1($1,$2,now(),now(),$3)',[i.tenant,i.account,''])).rejects.toMatchObject({code:'22023'});
    await db.exec("update tenant_feature_policy set enabled=false where feature_key='ssx_enabled'");
    await expect(accountCooldown(db,7200)).rejects.toMatchObject({code:'42501'});
  });
  it.each(['anon','authenticated'])('keeps %s unable to execute both RPCs',async role=>{
    db=await fixture();await db.exec('set role '+role);
    await expect(db.query('select public.record_ssx_account_cooldown_v1($1,$2,now(),now(),$3)',[i.tenant,i.account,'QA'])).rejects.toMatchObject({code:'42501'});
    await expect(db.query('select public.record_ssx_poll_error_v1($1,$2,$3,$4,$5,now(),$6,now(),$7::jsonb)',[i.tenant,i.account,i.unit,i.link,i.vehicle,'QA','{}'])).rejects.toMatchObject({code:'42501'});
  });
  it('fails closed on changed body and rolls back first function when second prestate is unknown',async()=>{
    db=await fixture(false);const original=await contractSnapshot(db);
    await db.exec("alter function public.record_ssx_poll_error_v1(uuid,uuid,uuid,uuid,uuid,timestamptz,text,timestamptz,jsonb) security definer");
    await expect(db.exec(forwardSql())).rejects.toMatchObject({code:'55000'});
    expect((await contractSnapshot(db))[0].body_hash).toBe(original[0].body_hash);
  });
  it('preserves an active long cooldown through guarded rollback, then reapply',async()=>{
    db=await fixture();await accountCooldown(db,7200);await unitBackoff(db,7200);
    const before=(await db.query('select poll_cooldown_until,last_error from integration_accounts where id=$1',[i.account])).rows;
    const cursor=(await db.query('select backoff_until,last_error from ingestion_cursors where provider_unit_id=$1',[i.unit])).rows;
    await db.exec(rollbackSql());expect((await db.query('select poll_cooldown_until,last_error from integration_accounts where id=$1',[i.account])).rows).toEqual(before);
    expect((await db.query('select backoff_until,last_error from ingestion_cursors where provider_unit_id=$1',[i.unit])).rows).toEqual(cursor);
    await expect(accountCooldown(db,7200)).rejects.toMatchObject({code:'22023'});
    await db.exec(forwardSql());await accountCooldown(db,7200);
  });
  it('keeps zero-duration lower bound and unit nullable backoff compatible',async()=>{
    db=await fixture();const observed=new Date().toISOString();
    expect(await accountCooldown(db,0,observed)).toMatchObject({version:1});
    await unitBackoff(db,0,observed);
    await expect(db.query('select public.record_ssx_account_cooldown_v1($1,$2,$3,null,$4)',[i.tenant,i.account,observed,'QA'])).rejects.toMatchObject({code:'22023'});
    await db.query('select public.record_ssx_poll_error_v1($1,$2,$3,$4,$5,$6,$7,null,$8::jsonb)',[i.tenant,i.account,i.unit,i.link,i.vehicle,observed,'QA','{}']);
    expect((await db.query<{backoff_until:Date|null}>('select backoff_until from ingestion_cursors')).rows[0].backoff_until).toBeNull();
  });
  it('rejects null observation and unknown predecessor body without mutation',async()=>{
    db=await fixture(false);const original=await contractSnapshot(db);
    await expect(db.query('select public.record_ssx_account_cooldown_v1($1,$2,null,now(),$3)',[i.tenant,i.account,'QA'])).rejects.toMatchObject({code:'22023'});
    const definition=(await db.query<{ddl:string}>("select pg_get_functiondef('public.record_ssx_account_cooldown_v1(uuid,uuid,timestamptz,timestamptz,text)'::regprocedure) ddl")).rows[0].ddl;
    await db.exec(definition.replace("interval '1 hour'","interval '59 minutes'"));
    await expect(db.exec(forwardSql())).rejects.toMatchObject({code:'55000'});
    expect((await contractSnapshot(db))[1].body_hash).toBe(original[1].body_hash);
  });
  it('retains longest deadline when observations arrive out of order',async()=>{
    db=await fixture();const now=Date.now();
    const long=await accountCooldown(db,7200,new Date(now).toISOString());
    const short=await accountCooldown(db,120,new Date(now+1000).toISOString());
    expect(short.cooldown_until).toBe(long.cooldown_until);
    // PGlite serializes commands; true two-session lock proof belongs to the own native fixture.
  });
});
