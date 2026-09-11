// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {seedDeliveryReceiptEmailHistory} from './helpers/deliveryReceiptEmailHistoryFixture';
const sql=(name:string)=>readFileSync(`supabase/migrations/${name}.sql`,'utf8');
const migration=sql('20260910131419_driver_delivery_receipt_foundation');
const pdfMigration=sql('20260910141902_add_delivery_receipt_pdf_access');
const emailMigration=sql('20260910143433_add_delivery_receipt_email_batches');
const operationsMigration=sql('20260910154811_complete_delivery_receipt_operations');
const integrityMigration=sql('20260910160603_preserve_delivery_receipt_scan_integrity');
const supplierPdfMigration=sql('20260910170631_add_delivery_receipt_supplier_pdf_profiles');
const ocrMigration=sql('20260910174335_add_delivery_receipt_ocr_queue');
const qualityPolicyMigration=sql('20260910181353_add_delivery_receipt_quality_policies');
const filtersMigration=sql('20260910183025_extend_delivery_receipt_operational_filters');
const nfseOnlyMigration=sql('20260910191452_support_nfse_only_delivery_receipts');
const emailFilenameMigration=sql('20260910192744_canonicalize_delivery_receipt_email_filename'),emailHistoryMigration=sql('20260910204500_delivery_receipt_email_history');
const ids = {
  tenant: '20000000-0000-4000-8000-000000000001',
  user: '10000000-0000-4000-8000-000000000001',
  driver: '60000000-0000-4000-8000-000000000001',
  vehicle: '61000000-0000-4000-8000-000000000001',
  trip: '80000000-0000-4000-8000-000000000001',
  stop: '82000000-0000-4000-8000-000000000001',
  event: '83000000-0000-4000-8000-000000000001',
  supplier: '30000000-0000-4000-8000-000000000001',
  fiscal: '90000000-0000-4000-8000-000000000001',
  fiscal2: '90000000-0000-4000-8000-000000000002',
  nfse: '91000000-0000-4000-8000-000000000001',
  cte: '92000000-0000-4000-8000-000000000001',
  proof: '93000000-0000-4000-8000-000000000001',
  proof2: '93000000-0000-4000-8000-000000000002',
  load: '50000000-0000-4000-8000-000000000001',
};

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create table public.tenants(id uuid primary key);
    create table public.clients(id uuid primary key,tenant_id uuid,company_name text,trade_name text,address_city text,address_state text);
    create table public.drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean,name text);
    create table public.vehicles(id uuid primary key,tenant_id uuid,plate text);
    create table public.dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,vehicle_id uuid,status text,load_id uuid);
    create table public.dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,status text,destination text,client_id uuid);
    create table public.dispatch_events(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,
      dispatch_stop_id uuid,event_type text,event_at timestamptz,created_by uuid);
    create table public.fiscal_documents(id uuid primary key,tenant_id uuid,load_id uuid,status text,
      fiscal_model text,invoice_number text,reference_number text,invoice_series text,access_key text,
      issue_date date,remitter text,remitter_cnpj text,recipient text,supplier_id uuid);
    create table public.nfse_documents(id uuid primary key,tenant_id uuid,nfse_number text,rps_number text,
      invoice_number text,series text,issue_date date,pagador_nome text,pagador_cnpj text,cliente_nome text,
      fiscal_document_ids uuid[],status text,load_id uuid,trip_id uuid);
    create table public.loads(id uuid primary key,tenant_id uuid);
    create table public.cte_documents(id uuid primary key,tenant_id uuid,batch_id uuid,cte_number text,
      cte_series text,access_key text,issued_at timestamptz,remitter text,remitter_cnpj text,recipient text,status text);
    create table public.load_documents(id uuid primary key,tenant_id uuid,load_id uuid,
      fiscal_document_id uuid,cte_document_id uuid);
    create table public.dispatch_stop_documents(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      dispatch_stop_id uuid,fiscal_document_id uuid,load_id uuid);
    create table public.dispatch_trip_loads(id uuid primary key default gen_random_uuid(),tenant_id uuid,dispatch_trip_id uuid,load_id uuid);
    create table public.proof_of_delivery(id uuid primary key,tenant_id uuid,fiscal_document_id uuid,
      load_id uuid,dispatch_trip_id uuid,dispatch_stop_id uuid,proof_type text,status text,
      storage_bucket text,storage_path text,receiver_name text,receiver_document text,receiver_role text,
      received_at timestamptz,validated_at timestamptz,validated_by uuid,rejection_reason text,
      metadata jsonb default '{}',created_at timestamptz,updated_at timestamptz,created_by uuid,
      latitude numeric(10,8),longitude numeric(11,8),accuracy numeric,version integer,is_active boolean,
      content_hash text,photo_url text,signature_url text);
    create table public.entity_audit_log(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      entity_type text,entity_id uuid,action text,old_value jsonb,new_value jsonb,source text);
    create function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) returns void language sql as $$
      insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_value,new_value,source)
      values($1,$2,$3,$4,$5,$6,$7)$$;
    create function public.is_tenant_operator_or_admin(uuid) returns boolean
      language sql stable as $$select true$$;
    create table public.driver_expenses(id uuid primary key,tenant_id uuid,approval_status text,no_receipt boolean,receipt_url text);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
  `);
  await db.exec(migration);
  await db.exec(pdfMigration);
  await db.exec(emailMigration);
  await db.exec(operationsMigration);
  await db.exec(integrityMigration);
  await db.exec(supplierPdfMigration);
  await db.exec(ocrMigration);
  await db.exec(qualityPolicyMigration);
  await db.exec(filtersMigration);
  await db.exec(nfseOnlyMigration);
  await db.exec(emailFilenameMigration);await db.exec(emailHistoryMigration);
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', ids.user]);
  await db.query('insert into tenants values($1)', [ids.tenant]);
  await db.query("insert into clients(id,tenant_id,company_name,trade_name,address_city,address_state) values($1,$2,'Cliente QA','Destino QA','Campinas','SP')", [ids.supplier,ids.tenant]);
  await db.query("insert into drivers values($1,$2,$3,true,'Motorista QA')", [ids.driver,ids.tenant,ids.user]);
  await db.query("insert into vehicles values($1,$2,'ABC1D23')", [ids.vehicle,ids.tenant]);
  await db.query("insert into dispatch_trips values($1,$2,$3,$4,'in_transit')", [ids.trip,ids.tenant,ids.driver,ids.vehicle]);
  await db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)',[ids.tenant,ids.trip,ids.load]);
  await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status,destination,client_id) values($1,$2,$3,'arrived','Rua do Cliente, 123',$4)", [ids.stop,ids.tenant,ids.trip,ids.supplier]);
  await db.query("insert into dispatch_events values($1,$2,$3,$4,'delivery_delivered',now(),$5)",
    [ids.event,ids.tenant,ids.trip,ids.stop,ids.user]);
  await db.query(`insert into fiscal_documents(id,tenant_id,load_id,status,fiscal_model,invoice_number,
      invoice_series,access_key,issue_date,remitter,remitter_cnpj,recipient,supplier_id)
    values($1,$2,gen_random_uuid(),'delivered','55','NF-123','1','123456789',current_date,
      'Fornecedor QA','00123456000100','Cliente QA',$3)`, [ids.fiscal,ids.tenant,ids.supplier]);
  await db.query('insert into dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id) values($1,$2,$3)',
    [ids.tenant,ids.stop,ids.fiscal]);
  await db.query(`insert into nfse_documents(id,tenant_id,nfse_number,series,issue_date,pagador_nome,
      pagador_cnpj,cliente_nome,fiscal_document_ids,status,trip_id)
    values($1,$2,'NFS-9','A',current_date,'Tomador QA','00987654000100','Cliente QA',array[$3]::uuid[],'issued',$4)`,
    [ids.nfse,ids.tenant,ids.fiscal,ids.trip]);
  await db.query(`insert into cte_documents(id,tenant_id,batch_id,cte_number,cte_series,access_key,
      issued_at,remitter,remitter_cnpj,recipient,status)
    values($1,$2,gen_random_uuid(),'CTE-77','2','987654321',now(),'Fornecedor QA','00123456000100','Cliente QA','issued')`,
    [ids.cte,ids.tenant]);
  await db.query('insert into load_documents values(gen_random_uuid(),$1,gen_random_uuid(),$2,$3)',
    [ids.tenant,ids.fiscal,ids.cte]);
});

afterAll(async () => db?.close());

describe('canonical delivery receipt foundation', () => {
  it('creates one receipt for the delivery and links NF-e, NFS-e and CT-e as peers', async () => {
    await db.query(`insert into proof_of_delivery(id,tenant_id,fiscal_document_id,dispatch_trip_id,
        dispatch_stop_id,status,storage_bucket,storage_path,receiver_name,received_at,metadata,created_by)
      values($1,$2,$3,$4,$5,'uploaded','receipts','tenant/delivery/signature.png','Recebedor',now(),$6::jsonb,$7)`,
      [ids.proof,ids.tenant,ids.fiscal,ids.trip,ids.stop,JSON.stringify({
        event_id:ids.event,
        receipt_original_path:'tenant/delivery/original.jpg',
        receipt_processed_path:'tenant/delivery/scan.jpg',
        receipt_thumbnail_path:'tenant/delivery/thumbnail.jpg',
        receipt_original_hash:'a'.repeat(64),
        receipt_processed_hash:'b'.repeat(64),
        receipt_thumbnail_hash:'c'.repeat(64),
        receipt_corners:{topLeft:{x:.1,y:.1},topRight:{x:.9,y:.1},bottomRight:{x:.9,y:.9},bottomLeft:{x:.1,y:.9}},
        receipt_rotation:90,
        receipt_quality_confirmed:true,
        signature_path:'tenant/delivery/signature.png',
        receipt_scan_quality:{width:1600,height:2200,quality:'accepted'},
      }),ids.user]);

    expect((await db.query(`select digital_status,physical_status,scan_mode,original_path,processed_path,thumbnail_path,
      original_hash,processed_hash,thumbnail_hash,scan_rotation,quality_confirmed,
      quality_policy_scope,quality_policy_version,quality_policy_snapshot->'thresholds' policy_thresholds
      from delivery_receipts`)).rows).toEqual([{
      digital_status:'uploaded',physical_status:'pending_return',scan_mode:'document_scan',
      original_path:'tenant/delivery/original.jpg',processed_path:'tenant/delivery/scan.jpg',
      thumbnail_path:'tenant/delivery/thumbnail.jpg',original_hash:'a'.repeat(64),processed_hash:'b'.repeat(64),
      thumbnail_hash:'c'.repeat(64),scan_rotation:90,quality_confirmed:true,
      quality_policy_scope:'baseline',quality_policy_version:1,
      policy_thresholds:expect.objectContaining({min_source_pixels:2_000_000,min_processed_short_side:900}),
    }]);
    expect((await db.query(`select r.document_kind
      from delivery_receipt_documents l join delivery_document_references r on r.id=l.document_reference_id
      order by r.document_kind`)).rows).toEqual([
      {document_kind:'cte'},{document_kind:'nfe'},{document_kind:'nfse'},
    ]);
  });

  it('does not duplicate the receipt when a second fiscal document shares the event', async () => {
    await db.query(`insert into fiscal_documents(id,tenant_id,status,fiscal_model,invoice_number)
      values($1,$2,'delivered','55','NF-456')`, [ids.fiscal2,ids.tenant]);
    await db.query('insert into dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id) values($1,$2,$3)',
      [ids.tenant,ids.stop,ids.fiscal2]);
    await db.query(`insert into proof_of_delivery(id,tenant_id,fiscal_document_id,dispatch_trip_id,
        dispatch_stop_id,status,receiver_name,received_at,metadata,created_by)
      values($1,$2,$3,$4,$5,'uploaded','Recebedor',now(),$6::jsonb,$7)`,
      [ids.proof2,ids.tenant,ids.fiscal2,ids.trip,ids.stop,JSON.stringify({event_id:ids.event}),ids.user]);

    expect((await db.query('select count(*)::int count from delivery_receipts')).rows)
      .toEqual([{count:1}]);
    expect((await db.query(`select count(*)::int count from delivery_receipt_documents`)).rows)
      .toEqual([{count:4}]);
  });

  it('leases OCR by processed hash, rejects stale completion and exposes searchable text',async()=>{
    const first=(await db.query<{result:{job_id:string;lease_token:string;processed_hash:string}}>('select claim_delivery_receipt_ocr_v1() result')).rows[0].result;
    const receipt=(await db.query<{id:string}>('select id from delivery_receipts where is_active')).rows[0].id;
    const nextHash='d'.repeat(64);await db.query('update delivery_receipts set processed_hash=$1 where id=$2',[nextHash,receipt]);
    const stale=(await db.query<{result:{status:string;applied:boolean}}>(
      "select complete_delivery_receipt_ocr_v1($1,$2,$3,'completed',0.91,'NF 123 entregue',null) result",
      [first.job_id,first.lease_token,first.processed_hash])).rows[0].result;
    expect(stale).toMatchObject({status:'superseded',applied:false});
    const current=(await db.query<{result:{job_id:string;lease_token:string;processed_hash:string}}>('select claim_delivery_receipt_ocr_v1() result')).rows[0].result;
    const completed=(await db.query<{result:{status:string;replayed:boolean}}>(
      "select complete_delivery_receipt_ocr_v1($1,$2,$3,'completed',0.91,'NF 123 entregue ao recebedor',null) result",
      [current.job_id,current.lease_token,current.processed_hash])).rows[0].result;
    expect(completed).toMatchObject({status:'completed',replayed:false});
    const replay=(await db.query<{result:{replayed:boolean}}>(
      "select complete_delivery_receipt_ocr_v1($1,$2,$3,'completed',0.91,'NF 123 entregue ao recebedor',null) result",
      [current.job_id,current.lease_token,current.processed_hash])).rows[0].result;
    expect(replay.replayed).toBe(true);
    const search=(await db.query<{result:{rows:Array<{receipt_id:string;confidence:number}>}}>(
      "select search_delivery_receipt_ocr_v1($1,'recebedor',50) result",[ids.tenant])).rows[0].result;
    expect(search.rows).toEqual([expect.objectContaining({receipt_id:receipt,confidence:0.91})]);
    expect((await db.query<Record<string,boolean>>(`select
      has_table_privilege('authenticated','delivery_receipt_ocr_jobs','select') browser_read,
      has_table_privilege('service_role','delivery_receipt_ocr_jobs','select') worker_table_read,
      has_function_privilege('authenticated','claim_delivery_receipt_ocr_v1()','execute') browser_claim,
      has_function_privilege('service_role','claim_delivery_receipt_ocr_v1()','execute') worker_claim`)).rows)
      .toEqual([{browser_read:false,worker_table_read:false,browser_claim:false,worker_claim:true}]);
  });

  it('lists by supplier and records independent digital and physical reviews', async () => {
    const listed=(await db.query<{result:{rows:Array<Record<string,unknown>>;total:number}}>(
      'select list_delivery_receipts_v1($1,$2::jsonb,50,0) result',
      [ids.tenant,JSON.stringify({supplier_id:ids.supplier,search:'NF-123'})],
    )).rows[0].result;
    expect(listed.total).toBe(1);
    expect(listed.rows[0]).toMatchObject({destination:'Rua do Cliente, 123',driver:{name:'Motorista QA'},
      vehicle:{plate:'ABC1D23'},client:{id:ids.supplier,name:'Destino QA',city:'Campinas',state:'SP'},load_ids:[ids.load],
      digital_status:'uploaded',physical_status:'pending_return'});

    for(const filters of [
      {trip_id:ids.trip},{load_id:ids.load},{client_id:ids.supplier},{destination_city:'Campinas'},
      {destination_state:'sp'},{receiver:'Recebedor'},
    ]){
      const filtered=(await db.query<{result:{total:number}}>('select list_delivery_receipts_v1($1,$2::jsonb,50,0) result',
        [ids.tenant,JSON.stringify(filters)])).rows[0].result;
      expect(filtered.total).toBe(1);
    }

    const receiptId=listed.rows[0].id as string;
    await db.query("select review_delivery_receipt_v1($1,$2,'validated',null,null)",[ids.tenant,receiptId]);
    expect((await db.query('select digital_status,physical_status from delivery_receipts where id=$1',[receiptId])).rows)
      .toEqual([{digital_status:'validated',physical_status:'pending_return'}]);
    await db.query('select receive_physical_delivery_receipt_v1($1,$2,null)',[ids.tenant,receiptId]);
    expect((await db.query('select digital_status,physical_status from delivery_receipts where id=$1',[receiptId])).rows)
      .toEqual([{digital_status:'validated',physical_status:'received'}]);
    expect((await db.query('select action from entity_audit_log order by action')).rows)
      .toEqual([{action:'ocr_completed'},{action:'physical_received'},{action:'review'}]);
  });

  it('keeps all new tables read-only to browsers and private helpers unexecutable', async () => {
    const result = await db.query<Record<string, boolean>>(`select
      has_table_privilege('authenticated','delivery_receipts','select') receipt_select,
      has_table_privilege('authenticated','delivery_receipts','insert') receipt_insert,
      has_table_privilege('authenticated','delivery_document_references','insert') reference_insert,
      has_table_privilege('authenticated','delivery_receipt_exports','select') export_select,
      has_table_privilege('authenticated','delivery_receipt_exports','insert') export_insert,
      has_table_privilege('authenticated','delivery_receipt_email_batches','insert') email_insert,
      has_table_privilege('authenticated','delivery_receipt_email_webhook_events','select') webhook_select,
      has_table_privilege('authenticated','delivery_receipt_email_templates','insert') template_insert,
      has_table_privilege('authenticated','delivery_receipt_replacements','select') replacement_select,
      has_table_privilege('authenticated','delivery_receipt_quality_policies','select') quality_policy_select,
      has_table_privilege('service_role','delivery_receipt_quality_policies','select') quality_policy_service_select,
      (select relrowsecurity from pg_class where oid='delivery_receipt_quality_policies'::regclass) quality_policy_rls,
      has_function_privilege('authenticated','_sync_delivery_receipt_from_proof(uuid)','execute') helper_execute,
      has_function_privilege('authenticated','_refresh_delivery_receipt_email_status(uuid)','execute') email_helper_execute,
      has_function_privilege('authenticated','list_delivery_receipts_v1(uuid,jsonb,integer,integer)','execute') list_execute,
      has_function_privilege('authenticated','prepare_delivery_receipt_pdf_v1(uuid,uuid,uuid,text)','execute') pdf_execute`);
    expect(result.rows).toEqual([{
      receipt_select:true,receipt_insert:false,reference_insert:false,export_select:true,export_insert:false,
      email_insert:false,webhook_select:false,template_insert:false,replacement_select:false,quality_policy_select:false,
      quality_policy_service_select:true,quality_policy_rls:true,
      helper_execute:false,email_helper_execute:false,
      list_execute:true,pdf_execute:true,
    }]);
    expect((await db.query(`select pg_get_constraintdef(oid) definition from pg_constraint
      where conname='delivery_receipt_email_provider_unique'`)).rows)
      .toEqual([{definition:'UNIQUE (provider_message_id)'}]);
  });

  it('versions quality rules and resolves client, tenant and baseline fallbacks', async () => {
    const baseline = {
      min_source_pixels:2_000_000,min_processed_short_side:900,min_brightness_reject:38,
      min_brightness_warn:58,max_brightness_reject:248,max_glare_warn:0.08,
      min_contrast_reject:8,min_contrast_warn:16,min_sharpness_reject:2,
      min_sharpness_warn:3.5,edge_cut_action:'warn',
    };
    const tenantThresholds={...baseline,min_source_pixels:3_000_000};
    const clientThresholds={...baseline,min_source_pixels:4_000_000,edge_cut_action:'reject'};
    const tenantSaved=(await db.query<{result:{id:string;version:number}}>(
      'select save_delivery_receipt_quality_policy_v1($1,null,$2::jsonb,null) result',
      [ids.tenant,JSON.stringify(tenantThresholds)],
    )).rows[0].result;
    const tenantV2=(await db.query<{result:{id:string;version:number}}>(
      'select save_delivery_receipt_quality_policy_v1($1,null,$2::jsonb,$3) result',
      [ids.tenant,JSON.stringify({...tenantThresholds,min_source_pixels:3_500_000}),tenantSaved.id],
    )).rows[0].result;
    const clientSaved=(await db.query<{result:{id:string;version:number}}>(
      'select save_delivery_receipt_quality_policy_v1($1,$2,$3::jsonb,null) result',
      [ids.tenant,ids.supplier,JSON.stringify(clientThresholds)],
    )).rows[0].result;
    expect(tenantSaved.version).toBe(1);expect(tenantV2.version).toBe(2);expect(clientSaved.version).toBe(1);

    const clientResolved=(await db.query<{result:{source:string;policy_id:string;thresholds:{min_source_pixels:number}}}>(
      'select resolve_delivery_receipt_quality_policy_v1($1) result',[ids.stop],
    )).rows[0].result;
    expect(clientResolved).toMatchObject({source:'client',policy_id:clientSaved.id,thresholds:{min_source_pixels:4_000_000}});
    await expect(db.query('update proof_of_delivery set metadata=$1::jsonb where id=$2',
      [JSON.stringify({event_id:ids.event,receipt_processed_path:'invalid.jpg',receipt_quality_policy:{
        source:'client',policy_id:tenantV2.id,version:2,
        thresholds:{...tenantThresholds,min_source_pixels:3_500_000},
      }}),ids.proof2],
    )).rejects.toThrow(/invalid_delivery_receipt_quality_policy_snapshot/);

    await db.query('select retire_delivery_receipt_quality_policy_v1($1,$2,$3)',[ids.tenant,ids.supplier,clientSaved.id]);
    const tenantResolved=(await db.query<{result:{source:string;policy_id:string}}>(
      'select resolve_delivery_receipt_quality_policy_v1($1) result',[ids.stop],
    )).rows[0].result;
    expect(tenantResolved).toMatchObject({source:'tenant',policy_id:tenantV2.id});

    await db.query('select retire_delivery_receipt_quality_policy_v1($1,null,$2)',[ids.tenant,tenantV2.id]);
    const fallback=(await db.query<{result:{source:string;policy_id:null;version:number}}>(
      'select resolve_delivery_receipt_quality_policy_v1($1) result',[ids.stop],
    )).rows[0].result;
    expect(fallback).toMatchObject({source:'baseline',policy_id:null,version:1});
    expect((await db.query("select count(*)::int count from delivery_receipt_quality_policies where is_active")).rows)
      .toEqual([{count:0}]);
  });

  it('prepares, attaches and completes one idempotently audited PDF download', async () => {
    const receipt=(await db.query<{id:string;updated_at:string}>('select id,updated_at from delivery_receipts limit 1')).rows[0];
    const request='94000000-0000-4000-8000-000000000001';
    const fileName='CANHOTO_FORNECEDOR_2026-09-10_CARGA_ENTREGA.pdf';
    const prepared=(await db.query<{result:{source_kind:string;path:string;request_id:string}}>(
      'select prepare_delivery_receipt_pdf_v1($1,$2,$3,$4) result',[ids.tenant,receipt.id,request,fileName],
    )).rows[0].result;
    expect(prepared).toMatchObject({source_kind:'processed_image',path:'tenant/delivery/scan.jpg',request_id:request});
    const pdfPath=`${ids.tenant}/delivery-pdfs/${receipt.id}/canhoto.pdf`;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,$2::jsonb)",
      [pdfPath,JSON.stringify({mimetype:'application/pdf',size:1_048_576})]);
    await db.query('select attach_delivery_receipt_pdf_v1($1,$2,$3,$4,$5)',
      [ids.tenant,receipt.id,request,pdfPath,receipt.updated_at]);
    await db.query('select complete_delivery_receipt_pdf_download_v1($1,$2,$3)',[ids.tenant,receipt.id,request]);
    await db.query('select complete_delivery_receipt_pdf_download_v1($1,$2,$3)',[ids.tenant,receipt.id,request]);
    expect((await db.query('select status,storage_path from delivery_receipt_exports where request_id=$1',[request])).rows)
      .toEqual([{status:'completed',storage_path:pdfPath}]);
    expect((await db.query("select count(*)::int count from entity_audit_log where action='pdf_downloaded'")).rows)
      .toEqual([{count:1}]);
  });

  it('queues one supplier-grouped email with matching NF-e and CT-e peers without leaking another NFS-e party', async () => {
    const receipt=(await db.query<{id:string}>('select id from delivery_receipts limit 1')).rows[0];
    const request='95000000-0000-4000-8000-000000000001';
    const queued=(await db.query<{result:{batch_id:string;receipt_count:number;status:string}}>(
      `select queue_delivery_receipt_email_v2($1,$2,'tax:00123456000100','Fornecedor QA',array[$3]::uuid[],array['fiscal@fornecedor.test'],
        'Comprovantes de entrega','Seguem os comprovantes.',$4::jsonb) result`,[ids.tenant,request,receipt.id,JSON.stringify({enabled:true,
          title:'Comprovante de entrega',subtitle:null,footer:'Documento gerado pelo operacional',
          fields:['delivery_date','destination','driver','vehicle','receiver','documents']})],
    )).rows[0].result;
    expect(queued).toMatchObject({batch_id:request,receipt_count:1,status:'queued'});
    expect((await db.query<{documents:Array<{kind:string;number:string}>}>(
      'select document_snapshot documents from delivery_receipt_email_items where batch_id=$1',[request],
    )).rows[0].documents.map(item=>item.kind).sort()).toEqual(['cte','nfe']);
    const databaseDate = (await db.query<{today:string}>("select current_date::text today")).rows[0].today;
    expect((await db.query<{file_name:string}>('select file_name from delivery_receipt_email_items where batch_id=$1',[request])).rows[0].file_name)
      .toBe(`CANHOTO_FORNECEDOR-QA_${databaseDate}_CARGA-${ids.load.slice(0,8)}_ENTREGA-${ids.event.slice(0,8)}.pdf`);
    expect((await db.query('select email_status from delivery_receipts where id=$1',[receipt.id])).rows)
      .toEqual([{email_status:'queued'}]);
    const claim=(await db.query<{result:{lease_token:string;items:Array<{documents:Array<{kind:string}>;cover:{supplier_key:string;documents:Array<{kind:string}>}}>}}>(
      'select claim_delivery_receipt_email_v1($1,$2) result',[ids.tenant,request],
    )).rows[0].result;
    expect(claim.items).toHaveLength(1);
    expect(claim.items[0]).toMatchObject({cover:{supplier_key:'tax:00123456000100',documents:[
      expect.objectContaining({kind:'cte'}),expect.objectContaining({kind:'nfe'}),
    ]}});
    const concurrent=(await db.query<{result:{status:string;items:unknown[]}}>(
      'select claim_delivery_receipt_email_v1($1,$2) result',[ids.tenant,request],
    )).rows[0].result;
    expect(concurrent).toMatchObject({status:'busy',items:[]});
    await expect(db.query("select complete_delivery_receipt_email_v1($1,$2,$3,'provider-message-1')",
      [ids.tenant,request,'97000000-0000-4000-8000-000000000001'])).rejects.toThrow(/lease_invalid/);
    await db.query("select complete_delivery_receipt_email_v1($1,$2,$3,'provider-message-1')",[ids.tenant,request,claim.lease_token]);
    const deliveredAt='2026-09-10T15:00:00.000Z';
    const applied=(await db.query<{result:{duplicate:boolean;status:string}}>(
      "select apply_delivery_receipt_email_webhook_v1('msg-webhook-1','provider-message-1','delivered',$1) result",[deliveredAt],
    )).rows[0].result;
    expect(applied).toMatchObject({duplicate:false,status:'delivered'});
    const duplicate=(await db.query<{result:{duplicate:boolean;status:string}}>(
      "select apply_delivery_receipt_email_webhook_v1('msg-webhook-1','provider-message-1','bounced',$1) result",['2026-09-10T16:00:00.000Z'],
    )).rows[0].result;
    expect(duplicate).toMatchObject({duplicate:true,status:'delivered'});
    const stale=(await db.query<{result:{ignored:boolean;status:string}}>(
      "select apply_delivery_receipt_email_webhook_v1('msg-webhook-2','provider-message-1','failed',$1) result",['2026-09-10T14:00:00.000Z'],
    )).rows[0].result;
    expect(stale).toMatchObject({ignored:true,status:'delivered'});
    expect((await db.query('select email_status from delivery_receipts where id=$1',[receipt.id])).rows)
      .toEqual([{email_status:'delivered'}]);
    expect((await db.query('select count(*)::int count from delivery_receipt_email_webhook_events')).rows)
      .toEqual([{count:2}]);
  });

  it('requires an exact receipt snapshot when an email request id is replayed',async()=>{
    const receipt=(await db.query<{id:string}>('select id from delivery_receipts limit 1')).rows[0];
    const request='95000000-0000-4000-8000-000000000002';
    await db.query(`select queue_delivery_receipt_email_v1($1,$2,'Fornecedor QA',array[$3]::uuid[],
      array['fiscal@fornecedor.test'],'Outro comprovante','Segue outro comprovante.')`,[ids.tenant,request,receipt.id]);
    expect((await db.query('select email_status from delivery_receipts where id=$1',[receipt.id])).rows)
      .toEqual([{email_status:'delivered'}]);
    const secondReceipt='96000000-0000-4000-8000-000000000001';
    const secondStop='96000000-0000-4000-8000-000000000002';
    const secondEvent='96000000-0000-4000-8000-000000000003';
    await db.query("insert into dispatch_stops values($1,$2,$3,'arrived','Outro destino')",[secondStop,ids.tenant,ids.trip]);
    await db.query("insert into dispatch_events values($1,$2,$3,$4,'delivery_delivered',now(),$5)",
      [secondEvent,ids.tenant,ids.trip,secondStop,ids.user]);
    await db.query(`insert into delivery_receipts(id,tenant_id,delivery_event_id,dispatch_trip_id,dispatch_stop_id,
      driver_id,vehicle_id,digital_status,pdf_path,delivered_at,created_by)
      values($1,$2,$3,$4,$5,$6,$7,'validated',$8,now(),$9)`,
      [secondReceipt,ids.tenant,secondEvent,ids.trip,secondStop,ids.driver,ids.vehicle,
        `${ids.tenant}/delivery-pdfs/${secondReceipt}/canhoto.pdf`,ids.user]);
    const reference=(await db.query<{id:string}>("select id from delivery_document_references where issuer_name='Fornecedor QA' limit 1")).rows[0];
    await db.query('insert into delivery_receipt_documents(receipt_id,document_reference_id,tenant_id) values($1,$2,$3)',
      [secondReceipt,reference.id,ids.tenant]);
    await expect(db.query(`select queue_delivery_receipt_email_v1($1,$2,'Fornecedor QA',array[$3]::uuid[],
      array['fiscal@fornecedor.test'],'Outro comprovante','Segue outro comprovante.')`,[ids.tenant,request,secondReceipt]))
      .rejects.toThrow(/delivery_receipt_email_request_conflict/);
  });

  it('saves supplier templates, exposes health metrics and versions audited replacements',async()=>{
    const template='97000000-0000-4000-8000-000000000010';
    const saved=(await db.query<{result:{template:{supplier_name:string;recipients:string[]}}}>(
      `select save_delivery_receipt_email_template_v1($1,$2,'Fornecedor QA',array['fiscal@fornecedor.test'],
        'Canhotos entregues','Seguem os comprovantes.',true,null) result`,[ids.tenant,template],
    )).rows[0].result;
    expect(saved.template).toMatchObject({supplier_name:'Fornecedor QA',recipients:['fiscal@fornecedor.test']});
    const replayed=(await db.query<{result:{replayed:boolean}}>(
      `select save_delivery_receipt_email_template_v1($1,$2,'Fornecedor QA',array['fiscal@fornecedor.test'],
        'Canhotos entregues','Seguem os comprovantes.',true,null) result`,[ids.tenant,template],
    )).rows[0].result;
    expect(replayed.replayed).toBe(true);

    const receipt=(await db.query<{id:string;updated_at:string}>("select id,updated_at from delivery_receipts where is_active and previous_receipt_id is null order by created_at desc limit 1")).rows[0];
    const request='97000000-0000-4000-8000-000000000011';
    const path=`${ids.tenant}/delivery-replacements/${receipt.id}/${request}/replacement.pdf`;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,$2::jsonb)",
      [path,JSON.stringify({mimetype:'application/pdf',size:1_048_576})]);
    const replaced=(await db.query<{result:{previous_receipt_id:string;replacement_receipt_id:string;digital_status:string}}>(
      "select replace_delivery_receipt_v1($1,$2,$3,$4,'Arquivo ilegível substituído',$5) result",
      [ids.tenant,receipt.id,request,path,receipt.updated_at],
    )).rows[0].result;
    expect(replaced).toMatchObject({previous_receipt_id:receipt.id,digital_status:'pending_validation'});
    expect((await db.query('select is_active,digital_status from delivery_receipts where id=$1',[receipt.id])).rows)
      .toEqual([{is_active:false,digital_status:'superseded'}]);
    expect((await db.query('select previous_receipt_id,version,scan_mode from delivery_receipts where id=$1',[replaced.replacement_receipt_id])).rows)
      .toEqual([{previous_receipt_id:receipt.id,version:2,scan_mode:'operator_replacement'}]);
    expect((await db.query<{count:number}>('select count(*)::int count from delivery_receipt_documents where receipt_id=$1',[replaced.replacement_receipt_id])).rows[0].count).toBeGreaterThan(0);

    const replacement=(await db.query<{updated_at:string}>('select updated_at from delivery_receipts where id=$1',[replaced.replacement_receipt_id])).rows[0];
    await db.query("select review_delivery_receipt_v1($1,$2,'rejected','Documento ainda ilegível',$3)",
      [ids.tenant,replaced.replacement_receipt_id,replacement.updated_at]);
    expect((await db.query('select digital_status,rejection_reason from delivery_receipts where id=$1',[replaced.replacement_receipt_id])).rows)
      .toEqual([{digital_status:'rejected',rejection_reason:'Documento ainda ilegível'}]);
    const rejected=(await db.query<{updated_at:string}>('select updated_at from delivery_receipts where id=$1',[replaced.replacement_receipt_id])).rows[0];
    await db.query("select review_delivery_receipt_v1($1,$2,'validated',null,$3)",[ids.tenant,replaced.replacement_receipt_id,rejected.updated_at]);

    const filtered=(await db.query<{result:{rows:Array<{id:string;scan_mode:string}>}}>(
      "select list_delivery_receipts_v1($1,$2::jsonb,100,0) result",
      [ids.tenant,JSON.stringify({driver_id:ids.driver,document_kind:'nfe',scan_mode:'operator_replacement',has_pdf:true})],
    )).rows[0].result;
    expect(filtered.rows).toEqual([expect.objectContaining({id:replaced.replacement_receipt_id,scan_mode:'operator_replacement'})]);
    const health=(await db.query<{result:{receipts:{replaced:number};emails:{failed:number};expenses:{pending:number};templates:unknown[]}}>(
      'select get_delivery_receipt_operations_v1($1) result',[ids.tenant],
    )).rows[0].result;
    expect(health.receipts.replaced).toBe(1);expect(health.emails.failed).toBeGreaterThanOrEqual(0);
    expect(health.expenses.pending).toBe(0);expect(health.templates).toHaveLength(1);
    expect((await db.query<{count:number}>("select count(*)::int count from entity_audit_log where action in('created','superseded','replacement_created','review')")).rows[0].count)
      .toBeGreaterThanOrEqual(5);
  });

  it('paginates and searches the complete email batch history with attachment snapshots',async()=>{
    const {batch}=await seedDeliveryReceiptEmailHistory(db,ids);
    const page=(await db.query<{result:{total:number;limit:number;offset:number;rows:Array<{supplier_key:string;items:unknown[]}>}}>(
      "select list_delivery_receipt_email_batches_v1($1,'Fornecedor Histórico','bounced',25,25) result",[ids.tenant])).rows[0].result;
    expect(page).toMatchObject({total:30,limit:25,offset:25});expect(page.rows).toHaveLength(5);
    const searched=(await db.query<{result:{total:number;rows:Array<{id:string;items:Array<{file_name:string}>}>}}>(
      "select list_delivery_receipt_email_batches_v1($1,'NF-HIST-777',null,25,0) result",[ids.tenant])).rows[0].result;
    expect(searched).toMatchObject({total:1,rows:[{id:batch,items:[{documents:[{kind:'nfse',number:'NF-HIST-777'}]}]}]});expect(searched.rows[0].items[0].file_name).toMatch(/^CANHOTO_.*\.pdf$/);
    await expect(db.query("select list_delivery_receipt_email_batches_v1($1,null,'invalid',25,0)",[ids.tenant])).rejects.toThrow(/invalid_delivery_receipt_email_history_query/);
  });

  it('links a receipt backed only by NFS-e without requiring NF-e or CT-e',async()=>{
    const trip='80000000-0000-4000-8000-000000000099',stop='82000000-0000-4000-8000-000000000099';
    const event='83000000-0000-4000-8000-000000000099',nfse='91000000-0000-4000-8000-000000000099';
    const proof='93000000-0000-4000-8000-000000000099';
    await db.query("insert into dispatch_trips(id,tenant_id,driver_id,vehicle_id,status) values($1,$2,$3,$4,'in_transit')",[trip,ids.tenant,ids.driver,ids.vehicle]);
    await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status,destination,client_id) values($1,$2,$3,'arrived','Destino NFS-e',$4)",[stop,ids.tenant,trip,ids.supplier]);
    await db.query("insert into dispatch_events values($1,$2,$3,$4,'delivery_delivered',now(),$5)",[event,ids.tenant,trip,stop,ids.user]);
    await db.query(`insert into nfse_documents(id,tenant_id,nfse_number,series,issue_date,pagador_nome,pagador_cnpj,
      cliente_nome,fiscal_document_ids,status,trip_id) values($1,$2,'NFS-ONLY','1',current_date,'Fornecedor NFS',
      '00123456000100','Cliente QA',array[]::uuid[],'issued',$3)`,[nfse,ids.tenant,trip]);
    await db.query(`insert into proof_of_delivery(id,tenant_id,dispatch_trip_id,dispatch_stop_id,status,storage_bucket,
      storage_path,receiver_name,received_at,metadata,created_by) values($1,$2,$3,$4,'uploaded','receipts',
      'tenant/nfse/signature.png','Recebedor NFS',now(),$5::jsonb,$6)`,[proof,ids.tenant,trip,stop,JSON.stringify({
        event_id:event,receipt_original_path:'tenant/nfse/original.jpg',receipt_processed_path:'tenant/nfse/scan.jpg',
        signature_path:'tenant/nfse/signature.png'}),ids.user]);
    expect((await db.query(`select reference.document_kind,reference.document_number
      from delivery_receipts receipt join delivery_receipt_documents link on link.receipt_id=receipt.id
      join delivery_document_references reference on reference.id=link.document_reference_id
      where receipt.dispatch_stop_id=$1`,[stop])).rows).toEqual([{document_kind:'nfse',document_number:'NFS-ONLY'}]);
  });

});
