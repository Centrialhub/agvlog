// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

const migrationNames=[
  '20260910131419_driver_delivery_receipt_foundation.sql','20260910141902_add_delivery_receipt_pdf_access.sql',
  '20260910143433_add_delivery_receipt_email_batches.sql','20260910154811_complete_delivery_receipt_operations.sql',
  '20260910160603_preserve_delivery_receipt_scan_integrity.sql','20260910170631_add_delivery_receipt_supplier_pdf_profiles.sql',
  '20260910181420_add_delivery_receipt_supplier_channels.sql',
];
const migrations=migrationNames.map(name=>readFileSync(`supabase/migrations/${name}`,'utf8'));
const ids={tenant:'20000000-0000-4000-8000-000000000001',user:'10000000-0000-4000-8000-000000000001',
  driver:'60000000-0000-4000-8000-000000000001',vehicle:'61000000-0000-4000-8000-000000000001',
  trip:'80000000-0000-4000-8000-000000000001',supplier:'30000000-0000-4000-8000-000000000001',
  fiscal:'90000000-0000-4000-8000-000000000001'};
const cover={enabled:true,title:'Comprovante de entrega',subtitle:null,footer:null,
  fields:['delivery_date','destination','driver','vehicle','receiver','documents']};
const capabilities={receipt_upload:true,document_metadata:true,supports_idempotency:true,multi_receipt_batch:false,
  max_files_per_request:1,accepted_document_kinds:['nfe','nfse','cte','other_fiscal','operational_reference']};
let db:PGlite,receiptIds:string[]=[];

beforeAll(async()=>{
  db=new PGlite();await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create schema auth;create schema storage;create schema extensions;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function extensions.digest(value bytea,algorithm text) returns bytea language sql immutable as $$
      select decode(md5(encode(value,'hex')||algorithm)||md5(algorithm||encode(value,'hex')),'hex')$$;
    create table public.tenants(id uuid primary key);
    create table public.clients(id uuid primary key,tenant_id uuid,company_name text);
    create table public.drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean,name text);
    create table public.vehicles(id uuid primary key,tenant_id uuid,plate text);
    create table public.dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,vehicle_id uuid,status text);
    create table public.dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,status text,destination text,client_id uuid);
    create table public.dispatch_events(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,dispatch_stop_id uuid,event_type text,event_at timestamptz,created_by uuid);
    create table public.fiscal_documents(id uuid primary key,tenant_id uuid,load_id uuid,status text,fiscal_model text,invoice_number text,
      reference_number text,invoice_series text,access_key text,issue_date date,remitter text,remitter_cnpj text,recipient text,supplier_id uuid);
    create table public.nfse_documents(id uuid primary key,tenant_id uuid,nfse_number text,rps_number text,invoice_number text,series text,
      issue_date date,pagador_nome text,pagador_cnpj text,cliente_nome text,fiscal_document_ids uuid[],status text,load_id uuid,trip_id uuid);
    create table public.cte_documents(id uuid primary key,tenant_id uuid,batch_id uuid,cte_number text,cte_series text,access_key text,
      issued_at timestamptz,remitter text,remitter_cnpj text,recipient text,status text);
    create table public.load_documents(id uuid primary key,tenant_id uuid,load_id uuid,fiscal_document_id uuid,cte_document_id uuid);
    create table public.dispatch_stop_documents(id uuid primary key default gen_random_uuid(),tenant_id uuid,dispatch_stop_id uuid,fiscal_document_id uuid,load_id uuid);
    create table public.proof_of_delivery(id uuid primary key,tenant_id uuid,fiscal_document_id uuid,load_id uuid,dispatch_trip_id uuid,
      dispatch_stop_id uuid,proof_type text,status text,storage_bucket text,storage_path text,receiver_name text,receiver_document text,
      receiver_role text,received_at timestamptz,validated_at timestamptz,validated_by uuid,rejection_reason text,metadata jsonb default '{}',
      created_at timestamptz,updated_at timestamptz,created_by uuid,latitude numeric(10,8),longitude numeric(11,8),accuracy numeric,
      version integer,is_active boolean,content_hash text,photo_url text,signature_url text);
    create table public.entity_audit_log(id uuid primary key default gen_random_uuid(),tenant_id uuid,entity_type text,entity_id uuid,
      action text,old_value jsonb,new_value jsonb,source text);
    create function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) returns void language sql as $$
      insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_value,new_value,source) values($1,$2,$3,$4,$5,$6,$7)$$;
    create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql stable as $$select true$$;
    create table public.driver_expenses(id uuid primary key,tenant_id uuid,approval_status text,no_receipt boolean,receipt_url text);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
  `);
  for(const migration of migrations)await db.exec(migration);
  await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',ids.user]);
  await db.query('insert into tenants values($1)',[ids.tenant]);
  await db.query("insert into clients values($1,$2,'Fornecedor QA')",[ids.supplier,ids.tenant]);
  await db.query("insert into drivers values($1,$2,$3,true,'Motorista QA')",[ids.driver,ids.tenant,ids.user]);
  await db.query("insert into vehicles values($1,$2,'ABC1D23')",[ids.vehicle,ids.tenant]);
  await db.query("insert into dispatch_trips values($1,$2,$3,$4,'in_transit')",[ids.trip,ids.tenant,ids.driver,ids.vehicle]);
  await db.query(`insert into fiscal_documents(id,tenant_id,load_id,status,fiscal_model,invoice_number,invoice_series,access_key,
    issue_date,remitter,remitter_cnpj,recipient,supplier_id) values($1,$2,gen_random_uuid(),'delivered','55','NF-123','1','123456789',
    current_date,'Fornecedor QA','00123456000100','Cliente QA',$3)`,[ids.fiscal,ids.tenant,ids.supplier]);
  const reference=(await db.query<{id:string}>(`insert into delivery_document_references(tenant_id,document_kind,fiscal_document_id,
    document_number,issuer_name,issuer_tax_id,supplier_id) values($1,'nfe',$2,'NF-123','Fornecedor QA','00123456000100',$3) returning id`,
    [ids.tenant,ids.fiscal,ids.supplier])).rows[0];
  for(let index=1;index<=5;index+=1){
    const suffix=String(index).padStart(12,'0'),receipt=`98000000-0000-4000-8000-${suffix}`;
    const stop=`98100000-0000-4000-8000-${suffix}`,event=`98200000-0000-4000-8000-${suffix}`;
    const path=`${ids.tenant}/delivery-pdfs/${receipt}/canhoto.pdf`;
    await db.query("insert into dispatch_stops values($1,$2,$3,'delivered','Destino QA',$4)",[stop,ids.tenant,ids.trip,ids.supplier]);
    await db.query("insert into dispatch_events values($1,$2,$3,$4,'delivery_delivered',now(),$5)",[event,ids.tenant,ids.trip,stop,ids.user]);
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,$2::jsonb)",
      [path,JSON.stringify({mimetype:'application/pdf',size:4_000_000})]);
    await db.query(`insert into delivery_receipts(id,tenant_id,delivery_event_id,dispatch_trip_id,dispatch_stop_id,driver_id,vehicle_id,
      digital_status,pdf_path,processed_hash,delivered_at,created_by) values($1,$2,$3,$4,$5,$6,$7,'validated',$8,$9,now(),$10)`,
      [receipt,ids.tenant,event,ids.trip,stop,ids.driver,ids.vehicle,path,String(index).repeat(64),ids.user]);
    await db.query('insert into delivery_receipt_documents(receipt_id,document_reference_id,tenant_id) values($1,$2,$3)',
      [receipt,reference.id,ids.tenant]);receiptIds.push(receipt);
  }
});
afterAll(async()=>db?.close());

describe('delivery receipt supplier channel database',()=>{
  it('splits by actual Base64 payload bytes before the fixed five-file limit',async()=>{
    const plan=(await db.query<{result:{receipt_count:number;batches:Array<{items:Array<{receipt_id:string}>;projected_bytes:number}>}}>(
      "select plan_delivery_receipt_email_batches_v1($1,'tax:00123456000100','Fornecedor QA',$2::uuid[],$3::jsonb) result",
      [ids.tenant,receiptIds,JSON.stringify(cover)])).rows[0].result;
    expect(plan.receipt_count).toBe(5);expect(plan.batches.map(batch=>batch.items.length)).toEqual([4,1]);
    expect(plan.batches.every(batch=>batch.projected_bytes<=25*1024*1024)).toBe(true);
  });

  it('versions the supplier template and snapshots both template and byte plan in each queued batch',async()=>{
    const template='98300000-0000-4000-8000-000000000001';
    const first=(await db.query<{result:{template:{updated_at:string;template_version:number}}}>(
      `select save_delivery_receipt_email_template_v2($1,$2,'tax:00123456000100','Fornecedor QA',array['fiscal@fornecedor.test'],
        'Canhotos QA','Primeira versão.',$3::jsonb,true,null) result`,[ids.tenant,template,JSON.stringify(cover)])).rows[0].result;
    const second=(await db.query<{result:{template:{template_version:number}}}>(
      `select save_delivery_receipt_email_template_v2($1,$2,'tax:00123456000100','Fornecedor QA',array['fiscal@fornecedor.test'],
        'Canhotos QA','Versão homologada.',$3::jsonb,true,$4) result`,[ids.tenant,template,JSON.stringify(cover),first.template.updated_at])).rows[0].result;
    expect(first.template.template_version).toBe(1);expect(second.template.template_version).toBe(2);
    const request='98400000-0000-4000-8000-000000000001';
    await db.query(`select queue_delivery_receipt_email_v2($1,$2,'tax:00123456000100','Fornecedor QA',$3::uuid[],
      array['fiscal@fornecedor.test'],'Canhotos QA','Versão homologada.',$4::jsonb)`,
      [ids.tenant,request,receiptIds.slice(0,4),JSON.stringify(cover)]);
    const batch=(await db.query<{template_version:number;template_customized:boolean;planned_attachment_bytes:number;size_plan_snapshot:unknown[]}>(
      'select template_version,template_customized,planned_attachment_bytes,size_plan_snapshot from delivery_receipt_email_batches where id=$1',[request])).rows[0];
    expect(batch).toMatchObject({template_version:2,template_customized:false});
    expect(batch.planned_attachment_bytes).toBeLessThanOrEqual(25*1024*1024);expect(batch.size_plan_snapshot).toHaveLength(4);
  });

  it('keeps the generic adapter draft-only and never creates a portal job',async()=>{
    const channel='98500000-0000-4000-8000-000000000001';
    const configuration={portal_origin:'https://portal.fornecedor.test',account_reference:null,
      credential_reference:'SUPPLIER_PORTAL_FORNECEDOR_QA',upload_path_hint:null};
    const saved=(await db.query<{result:{channel:{lifecycle_status:string;auto_enqueue:boolean;auto_enqueue_requested:boolean}}}>(
      `select save_delivery_receipt_supplier_channel_v1($1,$2,'tax:00123456000100','Fornecedor QA','supplier_portal_generic_v1',
        $3::jsonb,$4::jsonb,true,null) result`,[ids.tenant,channel,JSON.stringify(configuration),JSON.stringify(capabilities)])).rows[0].result;
    expect(saved.channel).toMatchObject({lifecycle_status:'draft',auto_enqueue:false,auto_enqueue_requested:true});
    await expect(db.query("select verify_delivery_receipt_supplier_channel_v1($1,$2,'verification-qa','test-worker',$3::jsonb)",
      [ids.tenant,channel,JSON.stringify(capabilities)])).rejects.toThrow(/adapter_unavailable/);
    expect((await db.query<{count:number}>('select count(*)::int count from delivery_receipt_channel_jobs')).rows[0].count).toBe(0);
  });

  it('uses one exclusive lease and records retryable failure for a verified specific adapter',async()=>{
    await db.query(`insert into delivery_receipt_channel_adapters(adapter_key,channel_kind,display_name,is_implemented,is_enabled,supported_capabilities)
      values('supplier_portal_qa_v1','portal','Adaptador QA',true,true,$1::jsonb)`,[JSON.stringify(capabilities)]);
    const channel='98500000-0000-4000-8000-000000000001',configuration={portal_origin:'https://qa.fornecedor.test',account_reference:null,
      credential_reference:'SUPPLIER_PORTAL_QA_TEST',upload_path_hint:null};
    const current=(await db.query<{updated_at:string}>('select updated_at from delivery_receipt_supplier_channels where id=$1',[channel])).rows[0];
    await db.query(`select save_delivery_receipt_supplier_channel_v1($1,$2,'tax:00123456000100','Fornecedor QA','supplier_portal_qa_v1',
      $3::jsonb,$4::jsonb,true,$5)`,[ids.tenant,channel,JSON.stringify(configuration),JSON.stringify(capabilities),current.updated_at]);
    const verified=(await db.query<{result:{status:string;queued_jobs:number}}>(
      "select verify_delivery_receipt_supplier_channel_v1($1,$2,'verification-qa-adapter','test-worker',$3::jsonb) result",
      [ids.tenant,channel,JSON.stringify(capabilities)])).rows[0].result;
    expect(verified).toMatchObject({status:'verified',queued_jobs:5});
    const claim=(await db.query<{result:{jobs:Array<{job_id:string;tenant_id:string;lease_token:string}>}}>(
      'select claim_delivery_receipt_channel_jobs_v1(1,null) result')).rows[0].result.jobs[0];
    const concurrent=(await db.query<{result:{claimed_count:number}}>(
      'select claim_delivery_receipt_channel_jobs_v1(1,$1) result',[claim.job_id])).rows[0].result;
    expect(concurrent.claimed_count).toBe(0);
    await db.query("select fail_delivery_receipt_channel_job_v1($1,$2,$3,'failed','portal_timeout',now()+interval '5 minutes')",
      [claim.tenant_id,claim.job_id,claim.lease_token]);
    await db.query('select retry_delivery_receipt_channel_job_v1($1,$2)',[ids.tenant,claim.job_id]);
    expect((await db.query('select status,attempt_count from delivery_receipt_channel_jobs where id=$1',[claim.job_id])).rows)
      .toEqual([{status:'queued',attempt_count:1}]);
  });
});
