// @vitest-environment node
import{afterAll,afterEach,beforeAll,beforeEach,expect,it}from'vitest';
import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import type{PGlite}from'@electric-sql/pglite';
import{createRedeliveryDatabase}from'./helpers/redeliveryDatabase';
import{operationIds as i}from'./helpers/operationOutcomeDatabase';
const previous=JSON.parse(readFileSync('docs/qa/drawn-signature-previous-functions.json','utf8')) as Array<{schema:string;name:string;args:string;definition:string;acl:string}>;
const contracts=JSON.parse(readFileSync('docs/qa/drawn-signature-sql-contract.json','utf8')) as Array<{signature:string;afterMd5:string;acl:string}>;
const migration=readFileSync('supabase/migrations/20261114110409_driver_optional_drawn_signature.sql','utf8');
let db:PGlite,trip:string,stop:string;
beforeAll(async()=>{
 ({db,trip,stop}=await createRedeliveryDatabase());
 await db.exec("alter table proof_of_delivery add column if not exists latitude numeric,add column if not exists longitude numeric,add column if not exists accuracy numeric;");
 await db.exec(readFileSync('supabase/migrations/20260910182124_enforce_driver_delivery_gps_and_refusal_evidence.sql','utf8'));
 for(const f of previous){await db.exec(f.definition+';');const signature=f.schema+'.'+f.name+'('+(f.args?f.args.split(', ').map(arg=>arg.slice(arg.indexOf(' ')+1)).join(', '):'')+')';
  await db.exec('revoke all on function '+signature+' from public,anon,authenticated,service_role;');
  for(const role of ['authenticated','anon','service_role'])if(f.acl.includes(role+'=X/'))await db.exec('grant execute on function '+signature+' to '+role+';');
 }
 await db.exec(migration);
},60000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function details(){const prefix=`${i.tenant}/deliveries/${trip}/${stop}/`;
 const original=prefix+'receipt/original/receipt.jpg',processed=prefix+'receipt/processed/scan.jpg';
 await db.query("insert into storage.objects(bucket_id,name) values('receipts',$1),('receipts',$2)",[original,processed]);
 return{receiver_name:'Recebedor sintetico',notes:'Entrega conferida',photo_paths:[processed],signature_path:null,
  receipt_original_path:original,receipt_processed_path:processed,receipt_original_hash:'a'.repeat(64),receipt_processed_hash:'b'.repeat(64),
  receipt_scan_mode:'document_scan',receipt_scan_quality:{accepted:true},receipt_quality_confirmed:true,latitude:-15.8,longitude:-43.3,accuracy_m:8};
}
const run=(outcome:string,data:unknown)=>db.query<{result:{replayed:boolean}}>('select public.driver_record_delivery_outcome_without_fiscal_gate_v1($1,$2,$3::jsonb,$4,\'arrived\') result',[stop,outcome,JSON.stringify(data),i.request2]);
it('binds all three changed function bodies and ACLs to the reviewed contract',async()=>{
 for(const c of contracts){const p=(await db.query<{prosrc:string;acl:string}>('select prosrc,proacl::text acl from pg_proc where oid=$1::regprocedure',[c.signature])).rows[0];
  expect(createHash('md5').update(p.prosrc).digest('hex')).toBe(c.afterMd5);expect(p.acl).toBe(c.acl);}
});
it.each(['delivered','partial_delivery'])('records %s with a real stored scan and no fabricated signature, with exact replay',async outcome=>{
 const d=await details();const data=outcome==='partial_delivery'?{...d,returned_items:{[i.item]:2}}:d;
 const first=await run(outcome,data);expect(first.rows[0].result.replayed).toBe(false);
 const proof=(await db.query('select storage_path,metadata from proof_of_delivery where dispatch_stop_id=$1',[stop])).rows[0] as {storage_path:string;metadata:{signature_path:null}};
 expect(proof.storage_path).toBe(d.receipt_processed_path);expect(proof.metadata.signature_path).toBeNull();
 expect((await run(outcome,data)).rows[0].result.replayed).toBe(true);
});
it('still rejects missing receipt, invalid GPS and forged signature paths',async()=>{
 const d=await details();for(const change of [{receipt_original_path:null},{latitude:null},{accuracy_m:151},{signature_path:'other-tenant/signature.png'}]){
  await db.exec('savepoint invalid_proof');await expect(run('delivered',{...d,...change})).rejects.toBeDefined();await db.exec('rollback to savepoint invalid_proof');}
});
it('still rejects a driver outside the trip',async()=>{
 const d=await details();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);await expect(run('delivered',d)).rejects.toBeDefined();
});
