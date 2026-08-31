// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createOperationDatabase,operationIds as i} from './helpers/operationOutcomeDatabase';
import {operationRpc as compositionRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite;let stop:string;
beforeAll(async()=>{({db,stop}=await createOperationDatabase(false));},30000);beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
describe('current LoadNotesPanel write sequence reproductions',()=>{
 it('marks an invoice delivered while stop/load remain in transit and no proof/event is produced',async()=>{
  await db.query("update fiscal_documents set status='delivered',delivery_meta=jsonb_build_object('delivery_at',now()) where id=$1",[i.doc]);
  expect((await db.query('select status from dispatch_stops where id=$1',[stop])).rows[0]).toEqual({status:'arrived'});
  expect((await db.query('select status from loads where id=$1',[i.load])).rows[0]).toEqual({status:'in_transit'});
  expect((await db.query('select count(*)::int n from proof_of_delivery')).rows[0]).toEqual({n:0});
 });
 it('retains the first redelivery status write when the separate detach is refused',async()=>{
  await db.query("update fiscal_documents set status='confirmed',delivery_meta='{"+'"redelivery":true'+"}' where id=$1",[i.doc]);
  await db.exec('savepoint detach');await expect(compositionRpc(db,'select remove_fiscal_documents_from_load_v2($1,$2,$3)',[i.tenant,i.load,[i.doc]])).rejects.toThrow(/load_locked/);
  await db.exec('rollback to savepoint detach');
  expect((await db.query('select status,load_id from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({status:'confirmed',load_id:i.load});
  expect((await db.query('select count(*)::int n from dispatch_stop_documents where fiscal_document_id=$1',[i.doc])).rows[0]).toEqual({n:1});
 });
});
