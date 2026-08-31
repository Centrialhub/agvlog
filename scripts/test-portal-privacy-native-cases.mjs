import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {portalPrivacySchema,portalPrivacyCandidate,seedPortalPrivacy,portalPrivacyIds as i} from '../src/test/helpers/portalPrivacyDatabase.ts';
export async function runPortalPrivacyNative({query,queryDatabase,literal:q}){
 // Separate database inside the disposable local cluster, never the application DB.
 await query('create database portal_privacy_qa;');const run=sql=>queryDatabase('portal_privacy_qa',sql);
 await run(portalPrivacySchema(false));const seed=[];await seedPortalPrivacy({query:async(sql,args=[])=>seed.push(sql.replace(/\$(\d+)/g,(_,n)=>q(args[Number(n)-1]))+';')});await run(seed.join('\n'));
 const identity=`set request.jwt.claim.sub=${q(i.user)};set role authenticated;`;
 const detail=(v='v2',doc=i.doc)=>run(`${identity}select get_client_portal_shipment_detail${v==='v2'?'_v2':''}(${q(doc)});`);
 const state=()=>run("select md5(jsonb_build_object('events',(select jsonb_agg(to_jsonb(t)) from dispatch_events t),'occurrences',(select jsonb_agg(to_jsonb(t)) from operational_events t),'documents',(select jsonb_agg(to_jsonb(t)) from fiscal_documents t),'access',(select jsonb_agg(to_jsonb(t)) from client_portal_access t))::text);");
 const candidate=portalPrivacyCandidate();const tests=[
  ['portal local baseline reproduces private-note and shared-stop leakage in native PostgreSQL',async()=>{for(const v of ['v1','v2']){const data=await detail(v);assert.match(data,/QA-NOTA-INTERNA-CONFIDENCIAL/);assert.match(data,/QA-OCORRENCIA-OUTRO-CLIENTE/);}}],
  ['portal privacy migration changes no business records or access rows',async()=>{const before=await state();await run('begin;'+candidate+'commit;');assert.equal(await state(),before);}],
  ['both portal APIs hide private notes and other-client notices but retain published notice',async()=>{for(const v of ['v1','v2']){const data=await detail(v);assert.doesNotMatch(data,/QA-NOTA-INTERNA|QA-OCORRENCIA-INTERNA|QA-OCORRENCIA-OUTRO-CLIENTE/);assert.match(data,/Aviso público desta nota/);}}],
  ['portal APIs deny another client document sharing the same stop',async()=>{for(const v of ['v1','v2'])await assert.rejects(()=>detail(v,i.otherDoc),/42501/);}],
  ['portal response confirms its actor/tenant and preserves financial/contact restrictions',async()=>{const data=JSON.parse(await detail());assert.deepEqual(data.context,{tenant_id:i.tenant,actor_id:i.user,document_id:i.doc});assert.equal(data.document.value,null);assert.equal(data.trip.driver_phone,null);assert.equal(data.document.public_status,'in_transit');}],
  ['portal access revocation is honored on the next transaction',async()=>{await run('update client_portal_access set active=false;');await assert.rejects(()=>detail(),/42501/);await run('update client_portal_access set active=true;');}],
  ['portal containment closes both endpoints without changing evidence or restoring private disclosure',async()=>{const before=await state();await run(readFileSync('docs/qa/PORTAL-DETAIL-CONTAINMENT-2026-08-30.sql','utf8'));for(const v of ['v1','v2'])await assert.rejects(()=>detail(v),/55000/);assert.equal(await state(),before);}],
  ['portal forward-restoration rehearsal retains the privacy fix and original business rows',async()=>{const before=await state();await run('begin;'+candidate.slice(candidate.indexOf('CREATE OR REPLACE FUNCTION'))+'commit;');assert.doesNotMatch(await detail(),/QA-NOTA-INTERNA|QA-OCORRENCIA-OUTRO-CLIENTE/);assert.equal(await state(),before);}],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
