// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createPortalPrivacyDatabase,portalDetail,portalPrivacyCandidate,portalPrivacyIds as i} from './helpers/portalPrivacyDatabase';
let db:PGlite;beforeAll(async()=>{db=await createPortalPrivacyDatabase(true);},30000);afterAll(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});
describe('shipment detail privacy: local SQL with repository authorization functions',()=>{
 it.each(['v1','v2'])('%s omits internal notes and unrelated occurrence while retaining a published note notice',async(version)=>{
  const result=await portalDetail(db,version);const json=JSON.stringify(result);
  expect(result.context).toEqual({tenant_id:i.tenant,actor_id:i.user,document_id:i.doc});
  expect(json).not.toMatch(/QA-NOTA-INTERNA|QA-OCORRENCIA-INTERNA|QA-OCORRENCIA-OUTRO-CLIENTE/);
  expect(json).toContain('Aviso público desta nota');expect(result.occurrences).toHaveLength(1);
  if(version==='v1')expect(result.events).toEqual([]);else expect(result.timeline).toEqual(expect.arrayContaining([expect.objectContaining({title:'Viagem iniciada'}),expect.objectContaining({title:'Chegou ao destino'})]));
 });
 it.each(['v1','v2'])('%s refuses another client document even in the same stop/load',async(version)=>{await expect(portalDetail(db,version,i.otherDoc)).rejects.toMatchObject({code:'42501'});});
 it.each(['v1','v2'])('%s rechecks revoked access',async(version)=>{await db.exec('update client_portal_access set active=false');await expect(portalDetail(db,version)).rejects.toMatchObject({code:'42501'});});
 it.each(['v1','v2'])('%s refuses an authenticated role without an actor',async(version)=>{await db.exec("set request.jwt.claim.sub=''");await expect(portalDetail(db,version)).rejects.toMatchObject({code:'42501'});});
 it.each(['v1','v2'])('%s refuses a document outside the authorized tenant',async(version)=>{await db.query('update fiscal_documents set tenant_id=$1 where id=$2',[i.otherTenant,i.doc]);await expect(portalDetail(db,version)).rejects.toMatchObject({code:'42501'});});
 it.each(['v1','v2'])('%s refuses soft-deleted documents without revealing their details',async(version)=>{await db.query('update fiscal_documents set deleted_at=now() where id=$1',[i.doc]);await expect(portalDetail(db,version)).rejects.toMatchObject({code:'42501'});});
 it.each(['v1','v2'])('%s does not widen an occurrence explicitly assigned to another note of the same client',async(version)=>{
  await db.query('update operational_events set client_id=$1 where fiscal_document_id=$2',[i.client,i.otherDoc]);
  expect(JSON.stringify(await portalDetail(db,version))).not.toContain('QA-OCORRENCIA-OUTRO-CLIENTE');
 });
 it.each(['v1','v2'])('%s permits a published client-scoped stop notice only on a compatible load',async(version)=>{
  await db.query("insert into operational_events(tenant_id,client_id,load_id,dispatch_stop_id,event_type,severity,description,visible_to_client,public_status) values($1,$2,$3,$4,'delivery_delay','low','Aviso público da parada',true,'resolved')",[i.tenant,i.client,i.load,i.stop]);
  expect(JSON.stringify(await portalDetail(db,version))).toContain('Aviso público da parada');
  await db.query("update operational_events set load_id=$1 where description='Aviso público da parada'",[i.otherDoc]);
  expect(JSON.stringify(await portalDetail(db,version))).not.toContain('Aviso público da parada');
 });
 it.each(['v1','v2'])('%s never reveals a foreign tenant parent/proof even with corrupted links',async(version)=>{
  await db.query('update loads set tenant_id=$1 where id=$2',[i.otherTenant,i.load]);
  await db.query("insert into proof_of_delivery(tenant_id,fiscal_document_id,proof_type,status,receiver_name) values($1,$2,'manual_receipt','pending','QA-RECEBEDOR-OUTRO-TENANT')",[i.otherTenant,i.doc]);
  const result=await portalDetail(db,version);expect(result.load).toBeNull();expect(result.proofs).toEqual([]);expect(JSON.stringify(result)).not.toContain('QA-RECEBEDOR-OUTRO-TENANT');
 });
 it('does not let an unrelated open occurrence change public status',async()=>{expect((await portalDetail(db)).document).toMatchObject({public_status:'in_transit'});});
 it('preserves financial/contact permission decisions, without returning internal notes when granted',async()=>{
  let result=await portalDetail(db);expect(result.document).toMatchObject({value:null,freight_value:null});expect(result.trip).toMatchObject({driver_name:null,driver_phone:null,vehicle_plate:null});
  await db.exec('update client_portal_access set can_view_financial=true,can_view_driver_contact=true,can_view_vehicle_live=true,can_download_documents=true');
  result=await portalDetail(db);expect(result.document).toMatchObject({value:1234,freight_value:123});expect(result.trip).toMatchObject({driver_name:'Motorista protegido',driver_phone:'TELEFONE-PRIVADO',vehicle_plate:'PLACA-PRIVADA'});
  expect(JSON.stringify(result)).not.toMatch(/QA-NOTA-INTERNA|QA-OCORRENCIA-OUTRO-CLIENTE/);
 });
 it('uses the current load assignment and ignores a later foreign-load stop',async()=>{
  const stop='83000000-0000-4000-8000-000000000099';
  await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status,destination) values($1,$2,$3,'delivered','QA-PARADA-DE-OUTRA-CARGA')",[stop,i.tenant,i.trip]);
  await db.query("insert into dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id,load_id,created_at) values($1,$2,$3,$4,now()+interval '1 day')",[i.tenant,stop,i.doc,i.otherDoc]);
  expect((await portalDetail(db)).stop).toMatchObject({id:i.stop});
  await db.query('update fiscal_documents set load_id=null where id=$1',[i.doc]);expect((await portalDetail(db)).stop).toBeNull();
 });
 it('does not mutate business history, proofs, shipment status or access on read',async()=>{
  const snapshot=async()=>JSON.stringify((await db.query("select jsonb_build_object('events',(select jsonb_agg(to_jsonb(t)) from dispatch_events t),'occurrences',(select jsonb_agg(to_jsonb(t)) from operational_events t),'documents',(select jsonb_agg(to_jsonb(t)) from fiscal_documents t),'access',(select jsonb_agg(to_jsonb(t)) from client_portal_access t))")).rows);
  const before=await snapshot();await portalDetail(db,'v1');await portalDetail(db);expect(await snapshot()).toBe(before);
 });
 it('retains API grants and rejects anonymous direct calls',async()=>{
  expect((await db.query("select has_function_privilege('anon','get_client_portal_shipment_detail_v2(uuid)','execute') anon,has_function_privilege('authenticated','get_client_portal_shipment_detail_v2(uuid)','execute') authenticated,has_function_privilege('service_role','get_client_portal_shipment_detail_v2(uuid)','execute') service_role")).rows[0]).toEqual({anon:false,authenticated:true,service_role:true});
  await db.exec('savepoint anonymous;set role anon');await expect(db.query('select public.get_client_portal_shipment_detail_v2($1)',[i.doc])).rejects.toMatchObject({code:'42501'});await db.exec('rollback to savepoint anonymous;release savepoint anonymous');
 });
 it('refuses repeated or drifted deployment instead of replacing unexpected functions',async()=>{await db.exec('savepoint guard');await expect(db.exec(portalPrivacyCandidate())).rejects.toThrow(/preflight refused/);await db.exec('rollback to savepoint guard;release savepoint guard');expect(JSON.stringify(await portalDetail(db))).not.toContain('QA-NOTA-INTERNA');});
});
