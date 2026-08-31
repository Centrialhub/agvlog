// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {expenseReceiptUpload} from '../../supabase/functions/secure-upload/expense-receipt';
import {expenseMfaDatabase,expenseMfaActor,expenseMfaRole} from './helpers/expenseMfaDatabase';
import {installPasswordSessionFixture} from './helpers/passwordSessionDatabase';
import {manualSettlement} from './helpers/expenseCreationDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite;
beforeAll(async()=>{({db}=await expenseMfaDatabase());await installPasswordSessionFixture(db);},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin');await expenseMfaActor(db);});
afterEach(async()=>{await db.exec('rollback');});
async function setup(){
 const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
 const context={tenant:i.tenant,actor:i.operator,request:randomUUID(),sourceType:'settlement',sourceId:await manualSettlement(db),mime:'image/png',bytes,declaredHash:createHash('sha256').update(bytes).digest('hex')};
 const inspect=vi.fn(async(args:Record<string,unknown>)=>{
  try{return {data:(await operationRpc(db,'select inspect_expense_receipt_upload($1,$2,$3,$4,$5,$6::jsonb) result',[args._tenant_id,args._actor_id,args._request_id,args._source_type,args._source_id,JSON.stringify(args._receipt)])).rows[0].result,error:null};}
  catch(error){return {data:null,error};}
 });
 const scan=vi.fn(async()=>({available:true,clean:true}));
 // Disposable SQL fixture only. The actual gateway writes through Storage API.
 const upload=vi.fn(async(path:string,_bytes:Uint8Array,options:{metadata:Record<string,unknown>})=>{await db.query("insert into storage.objects(bucket_id,name,user_metadata) values('receipts',$1,$2::jsonb)",[path,JSON.stringify(options.metadata)]);return {error:null};});
 return {context,deps:{inspect,scan,upload}};
}
describe('receipt gateway with actual password-session authorization SQL; no external requests',()=>{
 it.each(['owner','admin'])('accepts a password-only %s without skipping scan or upload authorization',async role=>{
  await expenseMfaRole(db,role);const s=await setup();expect((await expenseReceiptUpload(s.context,s.deps)).status).toBe(200);
  expect(s.deps.scan).toHaveBeenCalledOnce();expect(s.deps.upload).toHaveBeenCalledOnce();
 });
 it('stops a user whose membership is revoked during scanning',async()=>{
  const s=await setup();s.deps.scan.mockImplementation(async()=>{await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);return {available:true,clean:true};});
  expect((await expenseReceiptUpload(s.context,s.deps)).status).toBe(403);expect(s.deps.inspect).toHaveBeenCalledTimes(2);expect(s.deps.upload).not.toHaveBeenCalled();
 });
 it('recovers an existing upload after switching from AAL2 to a password-only session',async()=>{
  await expenseMfaRole(db,'admin');await expenseMfaActor(db,i.operator,'aal2');const s=await setup();
  const confirmed=await expenseReceiptUpload(s.context,s.deps);expect(confirmed.status).toBe(200);
  await expenseMfaActor(db);expect(await expenseReceiptUpload(s.context,s.deps)).toEqual(confirmed);
  expect(s.deps.scan).toHaveBeenCalledTimes(1);expect(s.deps.upload).toHaveBeenCalledTimes(1);
  expect((await db.query<{n:number}>('select count(*)::int n from driver_expenses')).rows[0].n).toBe(0);
 });
 it('uses caller JWT inspection in the deployed handler source',()=>{
  const source=readFileSync('supabase/functions/secure-upload/index.ts','utf8');
  expect(source).toContain('inspect: args => callerClient.rpc("inspect_expense_receipt_upload", args)');
  expect(source).not.toContain('inspect: args => adminClient.rpc("inspect_expense_receipt_upload", args)');
  // Local opt-in only; hosted Data API settings still require verification.
  expect(readFileSync('supabase/config.toml','utf8')).not.toContain('expense_creation_private');
 });
});
