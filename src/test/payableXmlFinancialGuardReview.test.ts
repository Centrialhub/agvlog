// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createUnloadingCostCorrectionDatabase} from './helpers/unloadingCostCorrectionDatabase';
import {installExtinctionCoreScenario} from './helpers/openComplementExtinctionDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
it('XML writer cannot overwrite a materialized unloading nominal and leaves no attachment link or command',async()=>{
 const db=await createUnloadingCostCorrectionDatabase();try{
  await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);const source=await installExtinctionCoreScenario(db);
  await db.exec('alter table storage.buckets add column if not exists allowed_mime_types text[]');
  await db.exec(readFileSync('supabase/migrations/20260914195721_finance_payable_xml_preserved_attachments.sql','utf8'));
  // Artifact already preserved is a fixture precondition here. Separate service tests prove upload.
  const artifact=randomUUID();await db.query("insert into payable_xml_private.artifacts(id,tenant_id,actor_id,request_id,sha256,size_bytes,expires_at,authorization_revision,received,summary) values($1,$2,$3,$4,$5,50,clock_timestamp()+interval '2 minutes',secure_upload_private.authorization_revision(),true,$6)",[artifact,i.tenant,i.operator,randomUUID(),'a'.repeat(64),{kind:'nfe',amount_cents:'5000',signature_verified:false,antivirus_verified:false}]);
  const before=(await db.query<{v:Record<string,unknown>;revision:string}>('select to_jsonb(p) v,md5(to_jsonb(p)::text) revision from payables p where id=$1',[source.payable_id])).rows[0];
  const money=(await db.query<{v:unknown}>('select jsonb_agg(to_jsonb(m) order by id) v from finance_movements m')).rows[0].v;
  await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:i.operator,active_tenant_id:i.tenant,role:'authenticated'})]);
  await db.exec('savepoint guarded_xml');
  await expect(financeAs(db,i.operator,'select record_finance_payable_xml($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),artifact_id:artifact,payable_id:source.payable_id,expected_revision:before.revision,fields:{supplier_name:before.v.supplier_name,category:before.v.category,description:before.v.description,amount_cents:'4000',due_date:before.v.due_date,competence_date:before.v.competence_date,document_number:before.v.document_number,status:before.v.status,notes:before.v.notes}}])).rejects.toMatchObject({code:'55000',message:'finance_unloading_cost_ticket_required'});
  await db.exec('rollback to guarded_xml');
  expect((await db.query<{v:unknown}>('select to_jsonb(p) v from payables p where id=$1',[source.payable_id])).rows[0].v).toEqual(before.v);
  expect((await db.query<{v:unknown}>('select jsonb_agg(to_jsonb(m) order by id) v from finance_movements m')).rows[0].v).toEqual(money);
  expect((await db.query('select (select count(*)::int from payable_xml_private.commands) commands,(select count(*)::int from payable_xml_private.links) links')).rows[0]).toEqual({commands:0,links:0});
 }finally{await db.close();}
},120000);
