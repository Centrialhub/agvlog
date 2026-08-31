import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {documentMetadataSql} from '../src/test/helpers/documentMetadataDatabase.ts';
import {operationIds as i} from '../src/test/helpers/operationOutcomeDatabase.ts';
export async function runDocumentMetadataNative({query,session,finish,waitForMarker,contested,literal:q}){
 const api=`set request.jwt.claim.sub=${q(i.operator)};set role authenticated;`;
 const call=value=>`${api}select update_load_document_metadata(${q(JSON.stringify(value))}::jsonb)`;
 const count=()=>query('select count(*) from delivery_document_metadata_audits;');
 const snapshot=()=>query(`select md5(jsonb_build_object('documents',(select jsonb_agg(to_jsonb(f) order by id) from fiscal_documents f),
  'attempts',(select jsonb_agg(to_jsonb(a) order by id) from delivery_attempts a),
  'history',(select jsonb_agg(to_jsonb(h) order by id) from delivery_document_outcomes h),
  'payments',(select jsonb_agg(to_jsonb(p) order by id) from driver_settlement_payments p))::text);`);
 const context=async()=>JSON.parse(await query(`${api}select get_load_operational_documents(${q(i.tenant)},${q(i.load)});`)).documents.find(row=>row.id===i.doc2).operational_metadata;
 let payload;
 const tests=[
  ['metadata migration changes no existing business rows and exposes a current context',async()=>{
   const before=await snapshot();const sql=documentMetadataSql();await query('begin;'+sql+'commit;');assert.equal(await snapshot(),before);
   console.log('Metadata candidate SHA256: '+createHash('sha256').update(sql).digest('hex'));
   const c=await context();assert.equal(c.document_id,i.doc2);assert.equal(c.load_id,i.load);
   payload={tenant_id:i.tenant,load_id:i.load,request_id:'bf000000-0000-4000-8000-000000000001',reason:'Conferência nativa de pagamento QA',
    items:[{document_id:i.doc2,attempt_id:c.attempt_id,revision:c.revision,changes:{payment_method:'pix'}}]};
  }],
  ['metadata grants restrict the writer, helper and immutable audit table',async()=>{
   assert.equal(await query("select has_function_privilege('authenticated','update_load_document_metadata(jsonb)','execute')||','||has_function_privilege('anon','update_load_document_metadata(jsonb)','execute')||','||has_function_privilege('authenticated','_apply_delivery_admin_patch(uuid,uuid,jsonb,text,uuid,text,uuid)','execute')||','||has_table_privilege('authenticated','delivery_document_metadata_audits','insert');"),'true,false,false,false');
  }],
  ['metadata rejects an invalid tenant or stale revision before any write',async()=>{
   const before=await snapshot();await assert.rejects(()=>query(call({...payload,tenant_id:i.otherTenant})+';'),/42501.*not_authorized/);
   await assert.rejects(()=>query(call({...payload,items:[{...payload.items[0],revision:'a'.repeat(64)}]})+';'),/40001.*context_changed/);
   assert.equal(await snapshot(),before);assert.equal(await count(),'0');
  }],
  ['metadata fails atomically behind a concurrent document lock',async()=>{
   const before=await snapshot();const holder=session('metadata-document-holder');
   holder.send(`begin;select id from fiscal_documents where id=${q(i.doc2)} for update;select '__METADATA_DOCUMENT_HELD__';`);await waitForMarker(holder,'__METADATA_DOCUMENT_HELD__');
   try{await assert.rejects(()=>query(call(payload)+';'),/40001.*document_metadata_concurrent_change/);}finally{await finish(holder,'rollback;');}
   assert.equal(await snapshot(),before);assert.equal(await count(),'0');
  }],
  ['metadata rejects a concurrently changing membership without sending a partial batch',async()=>{
   const holder=session('metadata-membership-holder');holder.send(`begin;select tenant_id from tenant_memberships where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)} for update;select '__METADATA_MEMBER_HELD__';`);
   await waitForMarker(holder,'__METADATA_MEMBER_HELD__');try{await assert.rejects(()=>query(call(payload)+';'),/40001.*document_metadata_concurrent_change/);}finally{await finish(holder,'rollback;');}
   assert.equal(await count(),'0');
  }],
  ['two simultaneous identical metadata requests commit exactly one audit',async()=>{
   await contested(call(payload),call(payload),{driver:false});assert.equal(await count(),'1');
   const confirmed=JSON.parse(await query(call(payload)+';'));assert.equal(confirmed.items[0].fields.payment_method,'pix');assert.equal(confirmed.document_count,1);
  }],
  ['a distinct stale metadata request cannot overwrite the committed conference',async()=>{
   const before=await snapshot();await assert.rejects(()=>query(call({...payload,request_id:'bf000000-0000-4000-8000-000000000002',items:[{...payload.items[0],changes:{payment_method:'boleto'}}]})+';'),/40001.*context_changed/);
   assert.equal(await snapshot(),before);assert.equal(await count(),'1');
  }],
  ['metadata rejects a changed payload under an already committed request key',async()=>{
   await assert.rejects(()=>query(call({...payload,reason:'Outro motivo QA'})+';'),/22023.*key_mismatch/);assert.equal(await count(),'1');
  }],
  ['legacy metadata writers and audit rewrites cannot bypass the explicit conference API',async()=>{
   await assert.rejects(()=>query(`update fiscal_documents set delivery_meta=delivery_meta||'{"payment_method":"boleto"}' where id=${q(i.doc2)};`),/55000.*requires_audited_api/);
   await assert.rejects(()=>query("update delivery_document_metadata_audits set reason='Alteração indevida QA';"),/append-only/);
   assert.equal(await count(),'1');
  }],
  ['metadata reapplication refuses to erase history',async()=>{
   const before=await snapshot();await assert.rejects(()=>query('begin;'+documentMetadataSql()+'commit;'),/Metadata audit/);assert.equal(await snapshot(),before);assert.equal(await count(),'1');
  }],
  ['legacy date aliases cannot fabricate a result on either the old or newly released attempt',async()=>{
   const before=await snapshot();
   for(const doc of [i.doc,i.doc2])await assert.rejects(()=>query(`update fiscal_documents set delivery_meta=delivery_meta||'{"delivered_at":"2030-01-01T00:00:00Z"}' where id=${q(doc)};`),/23514.*(audited_api|prior result alias)/);
   assert.equal(await snapshot(),before);assert.equal(await count(),'1');
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
