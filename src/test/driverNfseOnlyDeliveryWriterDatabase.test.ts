// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
const extractCurrentDeliveryWriter = () => {
  const source = migration('20260830142048_enable_audited_delivery_reallocation');
  const start = source.indexOf('CREATE OR REPLACE FUNCTION public.driver_record_delivery_outcome(');
  const body = source.indexOf('AS $function$', start);
  const end = source.indexOf('$function$;', body + 13);
  if (start < 0 || body < 0 || end < 0) throw new Error('current delivery writer not found');
  return source.slice(start, end + '$function$;'.length);
};
const fiscalSnapshotGate = migration('20260910211200_driver_delivery_fiscal_snapshot_gate');
const fiscalConflictResolution = migration('20260910213021_reconcile_legacy_cargo_gate_and_service_delivery_adapters');

const ids = {
  tenant: '20000000-0000-4000-8000-000000000099',
  user: '10000000-0000-4000-8000-000000000099',
  driver: '60000000-0000-4000-8000-000000000099',
  vehicle: '61000000-0000-4000-8000-000000000099',
  load: '70000000-0000-4000-8000-000000000099',
  trip: '80000000-0000-4000-8000-000000000099',
  stop: '82000000-0000-4000-8000-000000000099',
  nfse: '91000000-0000-4000-8000-000000000099',
  request: 'a0000000-0000-4000-8000-000000000099',
};

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema private;
    create schema storage;
    create schema storage_evidence_private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create function private.request_tenant_id() returns uuid language sql stable as
      $$select nullif(current_setting('test.active_tenant', true), '')::uuid$$;

    create table public.tenants(id uuid primary key);
    create table public.clients(id uuid primary key,tenant_id uuid,company_name text,trade_name text,
      address_city text,address_state text);
    create table public.drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean,name text);
    create table public.vehicles(id uuid primary key,tenant_id uuid,plate text);
    create table public.loads(id uuid primary key,tenant_id uuid);
    create table public.dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,vehicle_id uuid,
      status text,load_id uuid);
    create table public.dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,status text,
      destination text,client_id uuid,notes text,actual_arrival_at timestamptz,actual_departure_at timestamptz,
      updated_at timestamptz);
    create table public.dispatch_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      dispatch_trip_id uuid,dispatch_stop_id uuid,event_type text,notes text,payload jsonb not null default '{}',
      created_by uuid,event_at timestamptz not null default clock_timestamp(),created_at timestamptz not null default clock_timestamp());
    create table public.fiscal_documents(id uuid primary key,tenant_id uuid,load_id uuid,status text,
      fiscal_model text,invoice_number text,reference_number text,invoice_series text,access_key text,
      issue_date date,remitter text,remitter_cnpj text,recipient text,supplier_id uuid,updated_at timestamptz);
    create table public.nfse_documents(id uuid primary key,tenant_id uuid,nfse_number text,rps_number text,
      invoice_number text,series text,issue_date date,pagador_nome text,pagador_cnpj text,cliente_nome text,
      fiscal_document_ids uuid[],status text,load_id uuid,trip_id uuid,cancelled boolean default false,
      is_preview boolean default false);
    create table public.cte_documents(id uuid primary key,tenant_id uuid,batch_id uuid,cte_number text,
      cte_series text,access_key text,issued_at timestamptz,remitter text,remitter_cnpj text,recipient text,status text);
    create table public.load_documents(id uuid primary key,tenant_id uuid,load_id uuid,
      fiscal_document_id uuid,cte_document_id uuid);
    create table public.dispatch_stop_documents(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      dispatch_stop_id uuid,fiscal_document_id uuid,load_id uuid,delivery_attempt_id uuid);
    create table public.dispatch_trip_loads(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      dispatch_trip_id uuid,load_id uuid);
    create table public.load_items(id uuid primary key,tenant_id uuid,load_id uuid,fiscal_document_id uuid,
      quantity numeric,delivery_attempt_id uuid);
    create table public.current_delivery_document_outcomes(tenant_id uuid,dispatch_stop_id uuid,
      dispatch_stop_document_id uuid,fiscal_document_id uuid,outcome text);
    create view public.delivery_allocation_documents as
      select allocation.id as allocation_id,fiscal.id,fiscal.status,
        coalesce(allocation.load_id,fiscal.load_id) as load_id
      from public.dispatch_stop_documents as allocation
      join public.fiscal_documents as fiscal on fiscal.id=allocation.fiscal_document_id;
    create table public.proof_of_delivery(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      fiscal_document_id uuid,load_id uuid,dispatch_trip_id uuid,dispatch_stop_id uuid,proof_type text,status text,
      storage_bucket text,storage_path text,receiver_name text,receiver_document text,receiver_role text,
      received_at timestamptz,validated_at timestamptz,validated_by uuid,rejection_reason text,
      metadata jsonb not null default '{}',created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),created_by uuid,latitude numeric(10,8),
      longitude numeric(11,8),accuracy numeric,version integer not null default 1,is_active boolean not null default true,
      content_hash text,photo_url text,signature_url text);
    create table public.operational_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      load_id uuid,report_details jsonb default '{}',payload jsonb default '{}');
    create table public.entity_audit_log(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      entity_type text,entity_id uuid,action text,old_value jsonb,new_value jsonb,source text);
    create table public.driver_expenses(id uuid primary key,tenant_id uuid,approval_status text,
      no_receipt boolean,receipt_url text);
    create table public.driver_settlement_payments(id uuid primary key,tenant_id uuid,receipt_url text);
    create table public.payables(id uuid primary key,tenant_id uuid,receipt_url text);
    create table public.occurrence_return_sheets(id uuid primary key,tenant_id uuid,signed_proof_url text);
    create table public.pallet_return_protocols(id uuid primary key,tenant_id uuid,signed_proof_url text);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,
      metadata jsonb,unique(bucket_id,name));

    create function storage_evidence_private.array_contains_path(_value jsonb,_path text)
    returns boolean language sql immutable as $$select case when jsonb_typeof(_value)='array' then exists(
      select 1 from jsonb_array_elements_text(_value) item(value) where item.value=_path) else false end$$;
    create function storage_evidence_private.is_retained(_bucket text,_path text,_tenant_id uuid default null)
    returns boolean language plpgsql stable security definer set search_path='' as $$
    begin
      if _bucket='receipts' then
        return false;
      end if;
      return false;
    end$$;
    create function storage_evidence_private.block_retained_delete() returns trigger language plpgsql
    security definer set search_path='' as $$begin
      if storage_evidence_private.is_retained(old.bucket_id,old.name,null) then
        raise exception 'storage_evidence_retention_required' using errcode='23514';end if;
      return old;
    end$$;
    create trigger block_retained_storage_evidence_delete before delete on storage.objects
      for each row execute function storage_evidence_private.block_retained_delete();

    create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql stable as $$select true$$;
    create function public._assert_driver_owns_trip(uuid) returns void language plpgsql stable as $$
      begin if not exists(select 1 from public.dispatch_trips trip join public.drivers driver on driver.id=trip.driver_id
        where trip.id=$1 and driver.user_id=auth.uid() and driver.active) then raise exception 'not_authorized';end if;end$$;
    create function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) returns void language sql as $$
      insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_value,new_value,source)
      values($1,$2,$3,$4,$5,$6,$7)$$;
    create function public.stop_terminal_statuses() returns text[] language sql immutable as $$
      select array['completed','delivered','cancelled','skipped','refused','returned','partial_delivery','failed']::text[]$$;
    create function public._lock_driver_delivery_stop(uuid) returns setof public.dispatch_stops language sql as $$
      select * from public.dispatch_stops where id=$1 for update$$;
    create function public._delivery_items_for_stop(uuid)
      returns table(id uuid,tenant_id uuid,load_id uuid,fiscal_document_id uuid,quantity numeric)
      language sql stable as $$
        select item.id,item.tenant_id,item.load_id,item.fiscal_document_id,item.quantity
        from public.load_items as item join public.dispatch_stop_documents as link
          on link.dispatch_stop_id=$1 and link.fiscal_document_id=item.fiscal_document_id$$;
    create function public.driver_create_operational_occurrence(uuid,text,text,text,uuid,uuid) returns uuid
      language plpgsql as $$declare v_id uuid:=gen_random_uuid();begin
        insert into public.operational_events(id,tenant_id,payload)
        select v_id,trip.tenant_id,'{}'::jsonb from public.dispatch_trips as trip where trip.id=$1;
        return v_id;end$$;
    create function public._prepare_delivery_proof(uuid,uuid,uuid,uuid) returns uuid language sql as $$select gen_random_uuid()$$;
    create function public._delivery_result_from_statuses(text[]) returns text language sql immutable as $$select $1[1]$$;
    create function public._derive_driver_delivery_result(uuid,uuid) returns void language sql as $$select$$;
  `);

  await db.exec(extractCurrentDeliveryWriter());
  await db.exec(migration('20260910131419_driver_delivery_receipt_foundation'));
  await db.exec(migration('20260910160603_preserve_delivery_receipt_scan_integrity'));
  await db.exec(migration('20260910181353_add_delivery_receipt_quality_policies'));
  await db.exec(migration('20260910182124_enforce_driver_delivery_gps_and_refusal_evidence'));
  await db.exec(migration('20260910190649_enforce_driver_delivery_receipt_evidence'));
  await db.exec(migration('20260910191452_support_nfse_only_delivery_receipts'));
  await db.exec(migration('20260910204602_ensure_nfse_only_delivery_receipt'));
  await db.exec(fiscalSnapshotGate);
  await db.exec(fiscalConflictResolution);

  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', ids.user]);
  await db.query('select set_config($1,$2,false)', ['test.active_tenant', ids.tenant]);
  await db.query('insert into auth.users values($1)', [ids.user]);
  await db.query('insert into tenants values($1)', [ids.tenant]);
  await db.query("insert into clients(id,tenant_id,company_name) values(gen_random_uuid(),$1,'Cliente NFS-e')", [ids.tenant]);
  await db.query("insert into drivers values($1,$2,$3,true,'Motorista NFS-e')", [ids.driver,ids.tenant,ids.user]);
  await db.query("insert into vehicles values($1,$2,'NFS1E99')", [ids.vehicle,ids.tenant]);
  await db.query('insert into loads values($1,$2)', [ids.load,ids.tenant]);
  await db.query("insert into dispatch_trips values($1,$2,$3,$4,'in_transit',null)",
    [ids.trip,ids.tenant,ids.driver,ids.vehicle]);
  await db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)',
    [ids.tenant,ids.trip,ids.load]);
  await db.query(`insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status,destination,actual_arrival_at)
    values($1,$2,$3,'arrived','Destino exclusivo NFS-e',clock_timestamp())`, [ids.stop,ids.tenant,ids.trip]);
  await db.query(`insert into nfse_documents(id,tenant_id,nfse_number,series,issue_date,pagador_nome,
      pagador_cnpj,cliente_nome,fiscal_document_ids,status,load_id,trip_id)
    values($1,$2,'NFS-ONLY-99','1',current_date,'Fornecedor NFS-e','00123456000100','Cliente NFS-e',
      array[]::uuid[],'issued',$3,$4)`, [ids.nfse,ids.tenant,ids.load,ids.trip]);
  await db.query(`insert into dispatch_stop_nfse_documents(tenant_id,dispatch_stop_id,nfse_document_id,load_id,linked_by)
    values($1,$2,$3,$4,$5)`, [ids.tenant,ids.stop,ids.nfse,ids.load,ids.user]);
}, 30_000);

afterAll(async () => db?.close());

describe('NFS-e-only driver delivery writer', () => {
  it('creates exactly one canonical receipt linked to NFS-e and requires no NF-e or CT-e', async () => {
    const prefix = `${ids.tenant}/deliveries/${ids.trip}/${ids.stop}/`;
    const paths = {
      original: `${prefix}receipt/original/canhoto.jpg`,
      processed: `${prefix}receipt/processed/canhoto.jpg`,
      thumbnail: `${prefix}receipt/thumbnail/canhoto.jpg`,
      signature: `${prefix}signatures/assinatura.png`,
    };
    await db.query(`insert into storage.objects(bucket_id,name) values
      ('receipts',$1),('receipts',$2),('receipts',$3),('receipts',$4)`,
    [paths.original,paths.processed,paths.thumbnail,paths.signature]);
    const details = {
      receiver_name: 'Recebedor NFS-e',
      photo_paths: [paths.original],
      signature_path: paths.signature,
      receipt_original_path: paths.original,
      receipt_processed_path: paths.processed,
      receipt_thumbnail_path: paths.thumbnail,
      receipt_original_hash: 'a'.repeat(64),
      receipt_processed_hash: 'b'.repeat(64),
      receipt_thumbnail_hash: 'c'.repeat(64),
      receipt_scan_mode: 'document_scan',
      receipt_scan_quality: { accepted: true, width: 1600, height: 2200 },
      receipt_corners: { topLeft: { x: .1, y: .1 }, topRight: { x: .9, y: .1 },
        bottomRight: { x: .9, y: .9 }, bottomLeft: { x: .1, y: .9 } },
      receipt_rotation: 0,
      receipt_quality_confirmed: true,
      latitude: -23.55052,
      longitude: -46.633308,
      accuracy_m: 12,
    };
    const fiscalSnapshot=(await db.query<{result:Record<string,unknown>}>(
      'select get_driver_delivery_fiscal_snapshot_v1($1,$2,$3) result',[ids.tenant,ids.trip,ids.stop])).rows[0].result;
    Object.assign(details,{fiscal_snapshot:fiscalSnapshot});

    const first = (await db.query<{result:{event_id:string;pod_ids:string[];replayed:boolean}}>(
      `select driver_record_delivery_outcome($1,'delivered',$2::jsonb,$3,'arrived') result`,
      [ids.stop,JSON.stringify(details),ids.request],
    )).rows[0].result;
    expect(first).toMatchObject({pod_ids:[],replayed:false});

    expect((await db.query(`select count(*)::int count from delivery_receipts
      where tenant_id=$1 and delivery_event_id=$2`, [ids.tenant,first.event_id])).rows).toEqual([{count:1}]);
    expect((await db.query(`select receipt.digital_status,receipt.physical_status,receipt.original_path,
        receipt.processed_path,receipt.signature_path,reference.document_kind,reference.document_number
      from delivery_receipts as receipt
      join delivery_receipt_documents as link on link.receipt_id=receipt.id
      join delivery_document_references as reference on reference.id=link.document_reference_id
      where receipt.delivery_event_id=$1`, [first.event_id])).rows).toEqual([{
      digital_status:'uploaded',physical_status:'pending_return',original_path:paths.original,
      processed_path:paths.processed,signature_path:paths.signature,
      document_kind:'nfse',document_number:'NFS-ONLY-99',
    }]);
    expect((await db.query('select count(*)::int count from proof_of_delivery')).rows).toEqual([{count:0}]);
    expect((await db.query('select count(*)::int count from fiscal_documents')).rows).toEqual([{count:0}]);
    expect((await db.query('select count(*)::int count from cte_documents')).rows).toEqual([{count:0}]);

    const replay = (await db.query<{result:{event_id:string;replayed:boolean}}>(
      `select driver_record_delivery_outcome($1,'delivered',$2::jsonb,$3,'arrived') result`,
      [ids.stop,JSON.stringify(details),ids.request],
    )).rows[0].result;
    expect(replay).toMatchObject({event_id:first.event_id,replayed:true});
    expect((await db.query('select count(*)::int count from delivery_receipts')).rows).toEqual([{count:1}]);
    expect((await db.query('select count(*)::int count from delivery_receipt_documents')).rows).toEqual([{count:1}]);
  });

  it('routes a mixed NF-e/NFS-e reallocation conflict once and replays the same audited decision', async () => {
    const trip='80000000-0000-4000-8000-000000000098';
    const stop='82000000-0000-4000-8000-000000000098';
    const otherStop='82000000-0000-4000-8000-000000000097';
    const document='90000000-0000-4000-8000-000000000098';
    const item='92000000-0000-4000-8000-000000000098';
    const request='a0000000-0000-4000-8000-000000000098';
    await db.query("insert into dispatch_trips values($1,$2,$3,$4,'in_transit',null)",
      [trip,ids.tenant,ids.driver,ids.vehicle]);
    await db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)',
      [ids.tenant,trip,ids.load]);
    await db.query(`insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status,destination,actual_arrival_at)
      values($1,$3,$4,'arrived','Destino original',clock_timestamp()),
        ($2,$3,$4,'pending','Destino realocado',null)`,[stop,otherStop,ids.tenant,trip]);
    await db.query("insert into fiscal_documents(id,tenant_id,load_id,status) values($1,$2,$3,'in_transit')",
      [document,ids.tenant,ids.load]);
    await db.query('insert into dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id,load_id) values($1,$2,$3,$4)',
      [ids.tenant,stop,document,ids.load]);
    await db.query('insert into load_items values($1,$2,$3,$4,1,null)',[item,ids.tenant,ids.load,document]);
    await db.query('insert into dispatch_stop_nfse_documents(tenant_id,dispatch_stop_id,nfse_document_id,load_id,linked_by) values($1,$2,$3,$4,$5)',
      [ids.tenant,stop,ids.nfse,ids.load,ids.user]);
    const snapshot=(await db.query<{result:{documents:Array<{kind:string}>}}>(
      'select get_driver_delivery_fiscal_snapshot_v1($1,$2,$3) result',[ids.tenant,trip,stop])).rows[0].result;
    expect(snapshot.documents.map(documentRow=>documentRow.kind).sort()).toEqual(['nfe','nfse']);
    await db.query('update dispatch_stop_documents set dispatch_stop_id=$1 where fiscal_document_id=$2',[otherStop,document]);
    const conflictPrefix=`${ids.tenant}/deliveries/${trip}/${stop}/`;
    const conflictEvidence={original:`${conflictPrefix}receipt/original/conflict.jpg`,
      processed:`${conflictPrefix}receipt/processed/conflict.jpg`,
      thumbnail:`${conflictPrefix}receipt/thumbnail/conflict.jpg`,
      signature:`${conflictPrefix}signatures/conflict.png`,photo:`${conflictPrefix}photos/conflict.jpg`};
    for(const path of Object.values(conflictEvidence))await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{}')",[path]);
    const details={receiver_name:'Recebedor',photo_paths:[conflictEvidence.photo],
      signature_path:conflictEvidence.signature,receipt_original_path:conflictEvidence.original,
      receipt_processed_path:conflictEvidence.processed,receipt_thumbnail_path:conflictEvidence.thumbnail,
      fiscal_snapshot:snapshot};
    const submit=async()=>(await db.query<{result:{confirmed:boolean;conflict:boolean;error_code:string;replayed:boolean}}>(
      "select driver_record_delivery_outcome($1,'delivered',$2::jsonb,$3,'arrived') result",
      [stop,JSON.stringify(details),request])).rows[0].result;
    const results=await Promise.all([submit(),submit()]);
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({confirmed:false,conflict:true,error_code:'delivery_fiscal_snapshot_changed',replayed:false}),
      expect.objectContaining({confirmed:false,conflict:true,error_code:'delivery_fiscal_snapshot_changed',replayed:true}),
    ]));
    expect((await db.query('select count(*)::int count from driver_delivery_fiscal_conflicts where request_id=$1',[request])).rows)
      .toEqual([{count:1}]);
    expect((await db.query("select count(*)::int count from entity_audit_log where action='driver_delivery_fiscal_snapshot_conflict' and entity_id=$1",[stop])).rows)
      .toEqual([{count:1}]);
    expect((await db.query('select count(*)::int count from dispatch_events where dispatch_stop_id=$1',[stop])).rows)
      .toEqual([{count:0}]);

    const resolutionRequest='b0000000-0000-4000-8000-000000000098';
    const resolved=(await db.query<{result:Record<string,unknown>}>(
      "select resolve_driver_delivery_fiscal_conflict_v1($1,$2,$3,'discard',$4) result",
      [ids.tenant,request,resolutionRequest,'Documentos realocados; motorista deve gerar uma tentativa nova.'])).rows[0].result;
    expect(resolved).toMatchObject({confirmed:false,status:'resolved',resolution_action:'discard',replacement_required:true,replayed:false});
    const oldAttempt=(await db.query<{result:Record<string,unknown>}>(
      "select driver_record_delivery_outcome($1,'delivered',$2::jsonb,$3,'arrived') result",
      [stop,JSON.stringify(details),request])).rows[0].result;
    expect(oldAttempt).toMatchObject({confirmed:false,status:'resolved',resolution_action:'discard',replacement_required:true,replayed:true});
    expect((await db.query('select count(*)::int count from dispatch_events where dispatch_stop_id=$1',[stop])).rows)
      .toEqual([{count:0}]);
    for(const path of Object.values(conflictEvidence)){
      expect((await db.query<{retained:boolean}>(
        "select storage_evidence_private.is_retained('receipts',$1,$2) retained",[path,ids.tenant])).rows)
        .toEqual([{retained:true}]);
      await expect(db.query("delete from storage.objects where bucket_id='receipts' and name=$1",[path]))
        .rejects.toThrow('storage_evidence_retention_required');
    }

    const driverView=(await db.query<{result:Record<string,unknown>}>(
      'select get_driver_delivery_fiscal_conflict_v1($1,$2) result',[ids.tenant,request])).rows[0].result;
    expect(driverView).toMatchObject({request_id:request,status:'resolved',resolution_action:'discard',replacement_required:true});
    expect(driverView).not.toHaveProperty('delivery_payload');expect(driverView).not.toHaveProperty('expected_snapshot');
    const operationsView=(await db.query<{result:Record<string,unknown>}>(
      'select get_operations_delivery_fiscal_conflict_v1($1,$2) result',[ids.tenant,request])).rows[0].result;
    expect(operationsView).toMatchObject({request_id:request,status:'resolved',expected_document_count:2,actual_document_count:1});
    expect(operationsView).not.toHaveProperty('delivery_payload');expect(operationsView).not.toHaveProperty('expected_snapshot');
    expect((await db.query<{allowed:boolean}>(
      "select has_table_privilege('authenticated','public.driver_delivery_fiscal_conflicts','select') allowed")).rows)
      .toEqual([{allowed:false}]);

    const prefix=`${ids.tenant}/deliveries/${trip}/${stop}/`;
    const proof={original:`${prefix}receipt/original/replacement.jpg`,processed:`${prefix}receipt/processed/replacement.jpg`,
      thumbnail:`${prefix}receipt/thumbnail/replacement.jpg`,signature:`${prefix}signatures/replacement.png`};
    for(const path of Object.values(proof))await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{}')",[path]);
    const fresh=(await db.query<{result:Record<string,unknown>}>(
      'select get_driver_delivery_fiscal_snapshot_v1($1,$2,$3) result',[ids.tenant,trip,stop])).rows[0].result;
    const replacementDetails={receiver_name:'Recebedor novo',photo_paths:[proof.processed],signature_path:proof.signature,
      fiscal_snapshot:fresh,receipt_original_path:proof.original,receipt_processed_path:proof.processed,
      receipt_thumbnail_path:proof.thumbnail,receipt_original_hash:'a'.repeat(64),receipt_processed_hash:'b'.repeat(64),
      receipt_thumbnail_hash:'c'.repeat(64),receipt_scan_mode:'document_scan',
      receipt_crop:{left:.05,top:.05,right:.95,bottom:.95},receipt_scan_quality:{accepted:true,width:1600,height:2200},
      receipt_corners:{topLeft:{x:.1,y:.1},topRight:{x:.9,y:.1},bottomRight:{x:.9,y:.9},bottomLeft:{x:.1,y:.9}},
      receipt_captured_at:'2026-09-10T18:00:00.000Z',receipt_rotation:0,receipt_quality_confirmed:true,
      latitude:-23.55052,longitude:-46.633308,accuracy_m:12};
    const replacementRequest='c0000000-0000-4000-8000-000000000098';
    const replacement=(await db.query<{result:{confirmed:boolean;replayed:boolean}}>(
      "select driver_record_delivery_outcome($1,'delivered',$2::jsonb,$3,'arrived') result",
      [stop,JSON.stringify(replacementDetails),replacementRequest])).rows[0].result;
    expect(replacement).toMatchObject({replayed:false});
    expect((await db.query('select count(*)::int count from delivery_receipts where dispatch_stop_id=$1',[stop])).rows)
      .toEqual([{count:1}]);
  });

  it('keeps retired service-only delivery signatures explicit and closed to browsers',async()=>{
    for(const signature of ['public.driver_finalize_delivery(uuid,text,text,text[],text,text,text)',
      'public.driver_update_stop_status(uuid,text,text)']){
      expect((await db.query<{allowed:boolean}>("select has_function_privilege('authenticated',$1,'execute') allowed",[signature])).rows)
        .toEqual([{allowed:false}]);
      expect((await db.query<{allowed:boolean}>("select has_function_privilege('service_role',$1,'execute') allowed",[signature])).rows)
        .toEqual([{allowed:true}]);
    }
    await expect(db.query("select driver_update_stop_status($1,'failed','Falha antiga')",[ids.stop]))
      .rejects.toThrow('driver_legacy_delivery_contract_retired');
  });

  it('serializes fiscal callback status with document locks and rechecks the revision without inverse stop triggers',async()=>{
    const trip='80000000-0000-4000-8000-000000000096';
    const stop='82000000-0000-4000-8000-000000000096';
    const nfse='91000000-0000-4000-8000-000000000096';
    const request='a0000000-0000-4000-8000-000000000096';
    await db.query("insert into dispatch_trips values($1,$2,$3,$4,'in_transit',null)",
      [trip,ids.tenant,ids.driver,ids.vehicle]);
    await db.query('insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status,destination,actual_arrival_at) '+
      "values($1,$2,$3,'arrived','Callback fiscal',clock_timestamp())",[stop,ids.tenant,trip]);
    await db.query(`insert into nfse_documents(id,tenant_id,nfse_number,status,trip_id,cancelled,is_preview)
      values($1,$2,'NFS-CALLBACK','issued',$3,false,false)`,[nfse,ids.tenant,trip]);
    await db.query(`insert into dispatch_stop_nfse_documents(tenant_id,dispatch_stop_id,nfse_document_id,linked_by)
      values($1,$2,$3,$4)`,[ids.tenant,stop,nfse,ids.user]);
    const captured=(await db.query<{result:Record<string,unknown>}>(
      'select get_driver_delivery_fiscal_snapshot_v1($1,$2,$3) result',[ids.tenant,trip,stop])).rows[0].result;

    // Callback-first order: it owns only the document row and commits. The
    // writer then takes stop -> document and must observe the changed status.
    await db.query("update nfse_documents set status='cancelled',cancelled=true where id=$1",[nfse]);
    const result=(await db.query<{result:Record<string,unknown>}>(
      "select driver_record_delivery_outcome($1,'delivered',$2::jsonb,$3,'arrived') result",
      [stop,JSON.stringify({fiscal_snapshot:captured}),request])).rows[0].result;
    expect(result).toMatchObject({confirmed:false,conflict:true,error_code:'delivery_fiscal_snapshot_changed'});
    expect((await db.query('select count(*)::int count from dispatch_events where dispatch_stop_id=$1',[stop])).rows)
      .toEqual([{count:0}]);
    expect((await db.query<{count:number}>(`select count(*)::int count from pg_trigger trigger
      join pg_class relation on relation.oid=trigger.tgrelid
      where not trigger.tgisinternal and relation.relname in('fiscal_documents','nfse_documents')
        and trigger.tgname like 'lock_%snapshot_stops%'`)).rows).toEqual([{count:0}]);
    expect((await db.query('select count(*)::int count from cte_documents')).rows).toEqual([{count:0}]);
  });

  it('guards every NFSe link field in the revision and fails stop-lock contention with a retryable contract',async()=>{
    const trip='80000000-0000-4000-8000-000000000095';
    const stop='82000000-0000-4000-8000-000000000095';
    const nfseA='91000000-0000-4000-8000-000000000095';
    const nfseB='91000000-0000-4000-8000-000000000094';
    await db.query("insert into dispatch_trips values($1,$2,$3,$4,'in_transit',null)",
      [trip,ids.tenant,ids.driver,ids.vehicle]);
    await db.query('insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status,destination,actual_arrival_at) '+
      "values($1,$2,$3,'arrived','Link NFS-e',clock_timestamp())",[stop,ids.tenant,trip]);
    await db.query(`insert into nfse_documents(id,tenant_id,nfse_number,status,trip_id,cancelled,is_preview) values
      ($1,$3,'NFS-LINK-A','issued',$4,false,false),($2,$3,'NFS-LINK-B','issued',$4,false,false)`,
      [nfseA,nfseB,ids.tenant,trip]);
    await db.query(`insert into dispatch_stop_nfse_documents(tenant_id,dispatch_stop_id,nfse_document_id,linked_by)
      values($1,$2,$3,$4)`,[ids.tenant,stop,nfseA,ids.user]);
    const capture=async()=>(await db.query<{result:Record<string,unknown>}>(
      'select get_driver_delivery_fiscal_snapshot_v1($1,$2,$3) result',[ids.tenant,trip,stop])).rows[0].result;
    const submit=async(snapshot:Record<string,unknown>,requestId:string)=>(await db.query<{result:Record<string,unknown>}>(
      "select driver_record_delivery_outcome($1,'delivered',$2::jsonb,$3,'arrived') result",
      [stop,JSON.stringify({fiscal_snapshot:snapshot}),requestId])).rows[0].result;

    const beforeLoad=await capture();
    await db.query('update dispatch_stop_nfse_documents set load_id=$1 where dispatch_stop_id=$2',[ids.load,stop]);
    expect(await submit(beforeLoad,'a0000000-0000-4000-8000-000000000095'))
      .toMatchObject({confirmed:false,error_code:'delivery_fiscal_snapshot_changed'});
    const beforeDocument=await capture();
    await db.query('update dispatch_stop_nfse_documents set nfse_document_id=$1 where dispatch_stop_id=$2',[nfseB,stop]);
    expect(await submit(beforeDocument,'a0000000-0000-4000-8000-000000000094'))
      .toMatchObject({confirmed:false,error_code:'delivery_fiscal_snapshot_changed'});
    const lockDefinition=(await db.query<{definition:string}>(`select pg_get_functiondef(
      'delivery_private.lock_delivery_fiscal_allocation_stop_v1()'::regprocedure) definition`)).rows[0].definition;
    expect(lockDefinition.toLowerCase()).toContain('for update nowait');
    expect(lockDefinition.toLowerCase()).toContain("errcode='40001'");
    expect((await db.query('select count(*)::int count from dispatch_events where dispatch_stop_id=$1',[stop])).rows)
      .toEqual([{count:0}]);
  });
});
