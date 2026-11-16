// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createDocumentMetadataDatabase} from './helpers/documentMetadataDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite;
const request='aa000000-0000-4000-8000-000000000001';
const set=(checked=true,revision=0,id=request,doc=i.doc,tenant=i.tenant)=>operationRpc(db,
 'select set_load_note_check($1,$2,$3,$4,$5,$6) result',[tenant,i.load,doc,checked,revision,id]);
const get=()=>operationRpc(db,'select get_load_note_checks($1,$2) result',[i.tenant,i.load]);
beforeAll(async()=>{({db}=await createDocumentMetadataDatabase());},30000);
beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));afterAll(()=>db?.close());
describe('load-specific pre-dispatch checks execute real SQL',()=>{
 it('starts empty, persists one note, and preserves delivery, custody and fiscal values',async()=>{
  const before=(await db.query('select to_jsonb(f) snapshot from fiscal_documents f where id=$1',[i.doc])).rows;
  expect((await get()).rows[0].result).toEqual([]);await set();
  expect((await get()).rows[0].result).toEqual([expect.objectContaining({document_id:i.doc,checked:true,revision:1,actor_id:i.operator})]);
  expect((await db.query('select to_jsonb(f) snapshot from fiscal_documents f where id=$1',[i.doc])).rows).toEqual(before);
  expect((await db.query('select count(*)::int n from delivery_document_metadata_audits')).rows[0]).toEqual({n:0});
 });
 it('replays exactly without duplicate events and rejects a changed request body',async()=>{
  const first=await set();expect((await set()).rows).toEqual(first.rows);
  await expect(set(false)).rejects.toThrow('load_note_check_key_mismatch');
  expect((await db.query('select count(*)::int n from load_note_check_events')).rows[0]).toEqual({n:1});
 });
 it('rejects a stale competing edit and supports explicitly unchecking the current revision',async()=>{
  await set();await expect(set(false,0,'aa000000-0000-4000-8000-000000000002')).rejects.toThrow('load_note_check_context_changed');
  await set(false,1,'aa000000-0000-4000-8000-000000000002');
  expect((await get()).rows[0].result).toEqual([expect.objectContaining({checked:false,revision:2})]);
 });
 it('isolates documents and loads and rejects unrelated identities',async()=>{
  await set();await set(true,0,'aa000000-0000-4000-8000-000000000002',i.doc2);
  expect((await get()).rows[0].result).toHaveLength(2);
  expect((await operationRpc(db,'select get_load_note_checks($1,$2) result',[i.tenant,i.load2])).rows[0].result).toEqual([]);
  await expect(set(true,0,'aa000000-0000-4000-8000-000000000003','aa000000-0000-4000-8000-000000000099')).rejects.toThrow('document_unavailable');
 });
 it('denies drivers, other tenants, anonymous calls and direct event writes',async()=>{
  await expect(set(true,0,request,i.doc,i.otherTenant)).rejects.toThrow('not_authorized');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  await expect(set()).rejects.toThrow('not_authorized');await expect(get()).rejects.toThrow('not_authorized');
  expect((await operationRpc(db,'select * from load_note_check_events')).rows).toEqual([]);
  expect((await db.query("select has_table_privilege('authenticated','load_note_check_events','insert') write,has_function_privilege('anon','set_load_note_check(uuid,uuid,uuid,boolean,integer,uuid)','execute') anonymous")).rows[0]).toEqual({write:false,anonymous:false});
  await db.query("select set_config('request.jwt.claim.sub','',false)");await expect(get()).rejects.toThrow('not_authorized');
 });
});
