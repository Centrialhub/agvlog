// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createPortalPrivacyDatabase,portalDetail,portalPrivacyCandidate} from './helpers/portalPrivacyDatabase';
const containment=readFileSync('docs/qa/PORTAL-DETAIL-CONTAINMENT-2026-08-30.sql','utf8').replace(/\r\n/g,'\n').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
let db:PGlite;beforeAll(async()=>{db=await createPortalPrivacyDatabase(true);},30000);afterAll(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});
const state=async()=>JSON.stringify((await db.query("select jsonb_build_object('events',(select jsonb_agg(to_jsonb(t)) from dispatch_events t),'occurrences',(select jsonb_agg(to_jsonb(t)) from operational_events t),'documents',(select jsonb_agg(to_jsonb(t)) from fiscal_documents t),'access',(select jsonb_agg(to_jsonb(t)) from client_portal_access t))")).rows);
describe('fail-closed portal containment',()=>{
 it('disables only the two read endpoints, preserves all evidence, then permits a local candidate rehearsal',async()=>{
  const before=await state();await db.exec(containment);
  for(const version of ['v1','v2'])await expect(portalDetail(db,version)).rejects.toMatchObject({code:'55000'});
  expect(await state()).toBe(before);
  // Local rollback-only rehearsal of forward restoration; never a production bypass.
  const candidate=portalPrivacyCandidate();await db.exec(candidate.slice(candidate.indexOf('CREATE OR REPLACE FUNCTION')));
  expect(JSON.stringify(await portalDetail(db))).not.toContain('QA-NOTA-INTERNA');expect(await state()).toBe(before);
 });
 it.each([
  ['body',"alter function get_client_portal_shipment_detail_v2(uuid) set search_path='public'"],
  ['anonymous grant','grant execute on function get_client_portal_shipment_detail(uuid) to anon'],
  ['missing API grant','revoke execute on function get_client_portal_shipment_detail_v2(uuid) from authenticated'],
 ])('refuses %s drift without modifying business records',async(_name,drift)=>{
  await db.exec(drift);const before=await state();await db.exec('savepoint refused');
  await expect(db.exec(containment)).rejects.toThrow(/containment refused/);await db.exec('rollback to savepoint refused;release savepoint refused');expect(await state()).toBe(before);
 });
});
