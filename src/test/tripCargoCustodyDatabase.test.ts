// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260910142606_driver_trip_cargo_custody_cycle.sql', 'utf8');
const integrityMigration = readFileSync('supabase/migrations/20260910191008_harden_trip_cargo_custody_integrity.sql', 'utf8');
const sealLifecycleMigration = readFileSync('supabase/migrations/20260910194438_complete_trip_cargo_seal_lifecycle.sql', 'utf8');
const id = {
  tenant: '20000000-0000-4000-8000-000000000001', driverUser: '10000000-0000-4000-8000-000000000001',
  operator: '10000000-0000-4000-8000-000000000002', owner: '10000000-0000-4000-8000-000000000003',
  driver: '60000000-0000-4000-8000-000000000001', vehicle: '70000000-0000-4000-8000-000000000001',
  trip: '80000000-0000-4000-8000-000000000001', load: '81000000-0000-4000-8000-000000000001',
  stop: '82000000-0000-4000-8000-000000000001', nfe: '83000000-0000-4000-8000-000000000001',
  nfse: '84000000-0000-4000-8000-000000000001', receipt: '85000000-0000-4000-8000-000000000001',
};
let db: PGlite;

async function actor(user: string) { await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); }
async function rpc<T>(sql: string, params: unknown[] = []) {
  await db.exec('set role authenticated');
  try { return (await db.query<T>(sql, params)).rows[0]; } finally { await db.exec('reset role'); }
}
const command = (request: string, action: string, payload: unknown = {}) => rpc<{ result: Record<string, unknown> }>(
  'select public.driver_update_trip_cargo_v1($1,$2,$3,$4,$5::jsonb) result',
  [id.tenant, id.trip, request, action, JSON.stringify(payload)],
);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema private;create schema storage;grant usage on schema private to authenticated,service_role;
    create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function private.request_tenant_id() returns uuid language sql stable as $$select nullif(current_setting('test.active_tenant',true),'')::uuid$$;
    grant execute on function private.request_tenant_id() to authenticated,service_role;
    create table tenants(id uuid primary key);
    create table tenant_memberships(tenant_id uuid,user_id uuid,active boolean,role text);
    create table drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean);
    create table vehicles(id uuid primary key,tenant_id uuid,plate text);
    create table dispatch_trips(id uuid primary key,tenant_id uuid,load_id uuid,driver_id uuid,vehicle_id uuid,status text,actual_start_at timestamptz,updated_at timestamptz default now());
    create table loads(id uuid primary key,tenant_id uuid,total_volume_m3 numeric,total_pallet_count integer,total_weight_kg numeric,
      supplier_manifest text,distribution_manifest text,shipment_manifest text,origin_manifest text,os_number text,external_load_number text,control_load_number text);
    create table dispatch_trip_loads(id uuid default gen_random_uuid(),tenant_id uuid,dispatch_trip_id uuid,load_id uuid);
    create table fiscal_documents(id uuid primary key,tenant_id uuid,load_id uuid,invoice_number text,reference_number text,deleted_at timestamptz,volume_count numeric);
    create table cte_documents(id uuid primary key,tenant_id uuid,load_ids uuid[],fiscal_document_ids uuid[],cte_number text,reference_number text,status text,cancelled_at timestamptz,is_voided boolean);
    create table nfse_documents(id uuid primary key,tenant_id uuid,load_id uuid,trip_id uuid,fiscal_document_ids uuid[],related_cte_ids uuid[],nfse_number text,invoice_number text,rps_number text,status text,cancelled boolean,is_preview boolean);
    create table dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,status text);
    create table dispatch_events(id uuid default gen_random_uuid(),tenant_id uuid,dispatch_trip_id uuid,event_type text,payload jsonb,created_by uuid,event_at timestamptz default clock_timestamp());
    create table delivery_receipts(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,dispatch_stop_id uuid,is_active boolean,physical_status text);
    create table audit_log(id uuid default gen_random_uuid(),tenant_id uuid,entity_type text,entity_id uuid,action text,new_data jsonb);
    create function _log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) returns void language sql as
      $$insert into public.audit_log(tenant_id,entity_type,entity_id,action,new_data) values($1,$2,$3,$4,$6)$$;
    insert into auth.users values('${id.driverUser}'),('${id.operator}'),('${id.owner}');
    insert into tenants values('${id.tenant}');
    insert into tenant_memberships values('${id.tenant}','${id.driverUser}',true,'driver'),('${id.tenant}','${id.operator}',true,'operator'),('${id.tenant}','${id.owner}',true,'owner');
    insert into drivers values('${id.driver}','${id.tenant}','${id.driverUser}',true);
    insert into vehicles values('${id.vehicle}','${id.tenant}','AAA1A11');
  `);
  await db.exec(migration);
  await db.exec(integrityMigration);
  await db.exec(sealLifecycleMigration);
}, 30_000);

beforeEach(async () => {
  await db.exec(`reset role;truncate trip_cargo_commands,trip_cargo_divergences,trip_cargo_evidence,trip_cargo_seals,
    trip_cargo_document_checks,trip_cargo_load_checks,trip_cargo_controls,delivery_receipts,dispatch_events,dispatch_stops,
    nfse_documents,cte_documents,fiscal_documents,dispatch_trip_loads,loads,dispatch_trips,audit_log,storage.objects;
    insert into dispatch_trips values('${id.trip}','${id.tenant}','${id.load}','${id.driver}','${id.vehicle}','planned',null,now());
    insert into loads values('${id.load}','${id.tenant}',10,2,100,'SUP-1',null,null,null,null,null,null);
    insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values('${id.tenant}','${id.trip}','${id.load}');
    insert into fiscal_documents values('${id.nfe}','${id.tenant}','${id.load}','NF-101',null,null,10);
    insert into nfse_documents values('${id.nfse}','${id.tenant}','${id.load}','${id.trip}',array['${id.nfe}']::uuid[],array[]::uuid[],'NFS-7',null,null,'issued',false,false);
    insert into dispatch_stops values('${id.stop}','${id.tenant}','${id.trip}','delivered');
    insert into storage.objects values('receipts','${id.tenant}/trip-cargo/${id.trip}/load.jpg'),
      ('receipts','${id.tenant}/trip-cargo/${id.trip}/tie.jpg'),
      ('receipts','${id.tenant}/trip-cargo/${id.trip}/seal-install.jpg'),
      ('receipts','${id.tenant}/trip-cargo/${id.trip}/seal-install-2.jpg'),
      ('receipts','${id.tenant}/trip-cargo/${id.trip}/seal-return.jpg'),
      ('receipts','${id.tenant}/trip-cargo/${id.trip}/seal-return-2.jpg'),
      ('receipts','${id.tenant}/trip-cargo/${id.trip}/seal-broken.jpg');
  `);
  await db.query("select set_config('test.active_tenant',$1,false)", [id.tenant]);
  await actor(id.driverUser);
});
afterAll(async () => { await db?.close(); });

describe('trip cargo custody executed by PostgreSQL', () => {
  it('accepts the assigned vehicle and snapshots NF-e, NFS-e and operational references as peers', async () => {
    await expect(db.query("update dispatch_trips set status='in_transit'")).rejects.toThrow('trip_cargo_departure_confirmation_required');
    await command('90000000-0000-4000-8000-000000000001', 'accept', { vehicle_id: id.vehicle });
    const kinds = (await db.query<{ source_kind: string }>('select source_kind from trip_cargo_document_checks order by source_kind')).rows.map(row => row.source_kind);
    expect(kinds).toEqual(['nfe', 'nfse', 'operational_reference']);
    expect((await db.query('select status from trip_cargo_controls')).rows).toEqual([{ status: 'accepted' }]);
  });

  it('blocks departure on incomplete documents and requires operational approval for a metric divergence', async () => {
    await command('90000000-0000-4000-8000-000000000002', 'accept', { vehicle_id: id.vehicle });
    await command('90000000-0000-4000-8000-000000000003', 'start_loading');
    const docs = (await db.query<{ id: string }>('select id from trip_cargo_document_checks')).rows.map(row => row.id);
    const payload = { vehicle_checked: true, tie_down_confirmed: true, seal_not_applicable_reason: 'Veículo sem ponto de lacre',
      documents: docs, loads: [{ load_id: id.load, volume_count: 9, pallet_count: 2, weight_kg: 100 }],
      evidence: [{ kind: 'loading', path: `${id.tenant}/trip-cargo/${id.trip}/load.jpg` }, { kind: 'tie_down', path: `${id.tenant}/trip-cargo/${id.trip}/tie.jpg` }] };
    const result = await command('90000000-0000-4000-8000-000000000004', 'confirm_cargo', payload);
    expect(result.result.status).toBe('loading');
    const divergence = (await db.query<{ id: string }>('select id from trip_cargo_divergences')).rows[0].id;
    await expect(command('90000000-0000-4000-8000-000000000005', 'mark_departed')).rejects.toThrow('trip_cargo_departure_blocked');
    await actor(id.operator);
    await rpc("select public.review_trip_cargo_divergence_v1($1,$2,'approved','Diferença aceita pela operação')", [id.tenant, divergence]);
    expect((await db.query('select status from trip_cargo_controls')).rows).toEqual([{ status: 'ready_to_depart' }]);
  });

  it('requires pre/post checklists and blocks normal close until the physical canhoto returns', async () => {
    await command('90000000-0000-4000-8000-000000000006', 'accept', { vehicle_id: id.vehicle });
    const docs = (await db.query<{ id: string }>('select id from trip_cargo_document_checks')).rows.map(row => row.id);
    await command('90000000-0000-4000-8000-000000000007', 'confirm_cargo', { vehicle_checked: true, tie_down_confirmed: true,
      seal_not_applicable_reason: 'Veículo sem ponto de lacre', documents: docs,
      loads: [{ load_id: id.load, volume_count: 10, pallet_count: 2, weight_kg: 100 }], evidence: [
        { kind: 'loading', path: `${id.tenant}/trip-cargo/${id.trip}/load.jpg` }, { kind: 'tie_down', path: `${id.tenant}/trip-cargo/${id.trip}/tie.jpg` },
      ] });
    await expect(command('90000000-0000-4000-8000-000000000008', 'mark_departed')).rejects.toThrow('trip_cargo_pre_checklist_required');
    await db.query("insert into dispatch_events(tenant_id,dispatch_trip_id,event_type,payload,created_by) values($1,$2,'checklist_pre',$3::jsonb,$4)",
      [id.tenant, id.trip, JSON.stringify({ checked_items: [0,1,2,3,4,5,6,7] }), id.driverUser]);
    await command('90000000-0000-4000-8000-000000000008', 'mark_departed');
    await db.query("update dispatch_trips set status='in_transit'");
    await db.query("update dispatch_trips set status='completed'");
    await expect(command('90000000-0000-4000-8000-000000000009', 'mark_returned')).rejects.toThrow('trip_cargo_post_checklist_required');
    await db.query("insert into dispatch_events(tenant_id,dispatch_trip_id,event_type,payload,created_by) values($1,$2,'checklist_post',$3::jsonb,$4)",
      [id.tenant, id.trip, JSON.stringify({ checked_items: [0,1,2,3,4] }), id.driverUser]);
    await command('90000000-0000-4000-8000-000000000009', 'mark_returned');
    await db.query('insert into delivery_receipts values($1,$2,$3,$4,true,$5)', [id.receipt, id.tenant, id.trip, id.stop, 'pending_return']);
    await actor(id.operator);
    await expect(rpc('select public.close_trip_cargo_v1($1,$2,null)', [id.tenant, id.trip])).rejects.toThrow('trip_cargo_physical_receipts_pending');
    await actor(id.owner);
    const override = await rpc<{ result: { override: boolean } }>('select public.close_trip_cargo_v1($1,$2,$3) result', [id.tenant, id.trip, 'Canhoto físico extraviado; autorização supervisora']);
    expect(override.result.override).toBe(true);
    expect((await db.query("select action from audit_log where action='supervisor_close_override'")).rows).toHaveLength(1);
  });

  it('permits normal operational close only after every physical canhoto is reconciled', async () => {
    await command('90000000-0000-4000-8000-000000000011', 'accept', { vehicle_id: id.vehicle });
    const docs = (await db.query<{ id: string }>('select id from trip_cargo_document_checks')).rows.map(row => row.id);
    await command('90000000-0000-4000-8000-000000000012', 'confirm_cargo', { vehicle_checked: true, tie_down_confirmed: true,
      seal_not_applicable_reason: 'Veículo sem ponto de lacre', documents: docs,
      loads: [{ load_id: id.load, volume_count: 10, pallet_count: 2, weight_kg: 100 }], evidence: [
        { kind: 'loading', path: `${id.tenant}/trip-cargo/${id.trip}/load.jpg` }, { kind: 'tie_down', path: `${id.tenant}/trip-cargo/${id.trip}/tie.jpg` },
      ] });
    await db.query("insert into dispatch_events(tenant_id,dispatch_trip_id,event_type,payload,created_by) values($1,$2,'checklist_pre',$3::jsonb,$4)",
      [id.tenant, id.trip, JSON.stringify({ checked_items: [0,1,2,3,4,5,6,7] }), id.driverUser]);
    await command('90000000-0000-4000-8000-000000000013', 'mark_departed');
    await db.query("update dispatch_trips set status='in_transit'");
    await db.query("update dispatch_trips set status='completed'");
    await db.query("insert into dispatch_events(tenant_id,dispatch_trip_id,event_type,payload,created_by) values($1,$2,'checklist_post',$3::jsonb,$4)",
      [id.tenant, id.trip, JSON.stringify({ checked_items: [0,1,2,3,4] }), id.driverUser]);
    await command('90000000-0000-4000-8000-000000000014', 'mark_returned');
    await db.query("insert into delivery_receipts values($1,$2,$3,$4,true,'received')", [id.receipt, id.tenant, id.trip, id.stop]);
    await actor(id.operator);
    const result = await rpc<{ result: { override: boolean } }>('select public.close_trip_cargo_v1($1,$2,null) result', [id.tenant, id.trip]);
    expect(result.result.override).toBe(false);
    expect((await db.query("select action from audit_log where action='close_after_physical_reconciliation'")).rows).toHaveLength(1);
  });

  it('deduplicates command retries and keeps mutation helpers unavailable to anon', async () => {
    const request = '90000000-0000-4000-8000-000000000010';
    const first = await command(request, 'accept', { vehicle_id: id.vehicle });
    expect(await command(request, 'accept', { vehicle_id: id.vehicle })).toEqual(first);
    await expect(command(request, 'start_loading')).rejects.toThrow('trip_cargo_request_conflict');
    const acl = await db.query("select has_function_privilege('anon','public.driver_update_trip_cargo_v1(uuid,uuid,uuid,text,jsonb)','execute') anon,has_function_privilege('authenticated','private.driver_update_trip_cargo(uuid,uuid,uuid,text,jsonb)','execute') helper");
    expect(acl.rows).toEqual([{ anon: false, helper: false }]);
  });

  it('uses fiscal volume count instead of cubic volume and rejects fictitious evidence paths',async()=>{
    await db.query('update loads set total_volume_m3=999 where id=$1',[id.load]);
    await command('90000000-0000-4000-8000-000000000020','accept',{vehicle_id:id.vehicle});
    expect((await db.query('select expected_volume_count::float8 expected_volume_count from trip_cargo_load_checks')).rows).toEqual([{expected_volume_count:10}]);
    const docs=(await db.query<{id:string}>('select id from trip_cargo_document_checks')).rows.map(row=>row.id);
    await expect(command('90000000-0000-4000-8000-000000000021','confirm_cargo',{vehicle_checked:true,tie_down_confirmed:true,
      seal_not_applicable_reason:'Veículo sem ponto de lacre',documents:docs,loads:[{load_id:id.load,volume_count:10,pallet_count:2,weight_kg:100}],
      evidence:[{kind:'loading',path:`${id.tenant}/trip-cargo/${id.trip}/missing.jpg`},{kind:'tie_down',path:`${id.tenant}/trip-cargo/${id.trip}/tie.jpg`}]}))
      .rejects.toThrow('trip_cargo_evidence_object_missing');
  });

  it('rejects a divergence load outside the trip and binds document divergences',async()=>{
    await command('90000000-0000-4000-8000-000000000022','accept',{vehicle_id:id.vehicle});
    const control=(await db.query<{id:string}>('select id from trip_cargo_controls')).rows[0].id;
    await expect(db.query(`insert into trip_cargo_divergences(tenant_id,control_id,load_id,divergence_kind,description,reported_by)
      values($1,$2,$3,'other','Carga estranha',$4)`,[id.tenant,control,'81000000-0000-4000-8000-000000000099',id.driverUser]))
      .rejects.toThrow('trip_cargo_divergence_load_outside_trip');
    await db.query(`delete from trip_cargo_document_checks where source_kind<>'nfe'`);
    await db.query(`insert into trip_cargo_divergences(tenant_id,control_id,load_id,divergence_kind,description,reported_by)
      values($1,$2,$3,'document','Documento divergente',$4)`,[id.tenant,control,id.load,id.driverUser]);
    expect((await db.query('select document_check_id is not null linked from trip_cargo_divergences')).rows).toEqual([{linked:true}]);
  });

  it('persists the explicitly selected load and document from the driver command',async()=>{
    await command('90000000-0000-4000-8000-000000000023','accept',{vehicle_id:id.vehicle});
    const documents=(await db.query<{id:string}>('select id from trip_cargo_document_checks order by source_kind,id')).rows.map(row=>row.id);
    const affectedDocument=documents[1];
    await command('90000000-0000-4000-8000-000000000024','confirm_cargo',{vehicle_checked:true,tie_down_confirmed:true,
      seal_not_applicable_reason:'Veículo sem ponto de lacre',documents,loads:[{load_id:id.load,volume_count:10,pallet_count:2,weight_kg:100}],
      evidence:[{kind:'loading',path:`${id.tenant}/trip-cargo/${id.trip}/load.jpg`},{kind:'tie_down',path:`${id.tenant}/trip-cargo/${id.trip}/tie.jpg`}],
      divergences:[{kind:'document',description:'Documento divergente selecionado pelo motorista',load_id:id.load,
        document_check_id:affectedDocument,observed_value:affectedDocument}]});
    expect((await db.query('select load_id,document_check_id from trip_cargo_divergences')).rows)
      .toEqual([{load_id:id.load,document_check_id:affectedDocument}]);
  });

  it('fails closed when the explicit tenant differs from the signed active-tenant context', async () => {
    await db.query("select set_config('test.active_tenant','20000000-0000-4000-8000-000000000099',false)");
    await expect(command('90000000-0000-4000-8000-000000000015', 'accept', { vehicle_id: id.vehicle }))
      .rejects.toThrow('trip_cargo_not_authorized');
    await expect(rpc('select public.get_trip_cargo_control_v1($1,$2)', [id.tenant, id.trip]))
      .rejects.toThrow('trip_cargo_not_authorized');
  });

  it('requires installation and return evidence and records an immutable removed seal lifecycle', async () => {
    await command('90000000-0000-4000-8000-000000000030', 'accept', { vehicle_id: id.vehicle });
    const docs = (await db.query<{ id: string }>('select id from trip_cargo_document_checks')).rows.map(row => row.id);
    const basePayload = { vehicle_checked: true, tie_down_confirmed: true, seals: ['LACRE-101', 'LACRE-102'], documents: docs,
      loads: [{ load_id: id.load, volume_count: 10, pallet_count: 2, weight_kg: 100 }], evidence: [
        { kind: 'loading', path: `${id.tenant}/trip-cargo/${id.trip}/load.jpg` },
        { kind: 'tie_down', path: `${id.tenant}/trip-cargo/${id.trip}/tie.jpg` },
      ] };
    await expect(command('90000000-0000-4000-8000-000000000031', 'confirm_cargo', basePayload))
      .rejects.toThrow('trip_cargo_seal_installation_evidence_required');
    await expect(command('90000000-0000-4000-8000-000000000037', 'confirm_cargo', { ...basePayload, evidence: [
      ...basePayload.evidence, { kind: 'seal', path: `${id.tenant}/trip-cargo/${id.trip}/seal-install.jpg` },
    ], seal_evidence: [
      { seal_number: 'LACRE-101', path: `${id.tenant}/trip-cargo/${id.trip}/seal-install.jpg` },
      { seal_number: 'LACRE-102', path: `${id.tenant}/trip-cargo/${id.trip}/seal-install.jpg` },
    ] })).rejects.toThrow('trip_cargo_seal_installation_evidence_idx');
    const confirmedPayload = { ...basePayload, evidence: [
      ...basePayload.evidence, { kind: 'seal', path: `${id.tenant}/trip-cargo/${id.trip}/seal-install.jpg` },
      { kind: 'seal', path: `${id.tenant}/trip-cargo/${id.trip}/seal-install-2.jpg` },
    ], seal_evidence: [
      { seal_number: 'LACRE-101', path: `${id.tenant}/trip-cargo/${id.trip}/seal-install.jpg` },
      { seal_number: 'LACRE-102', path: `${id.tenant}/trip-cargo/${id.trip}/seal-install-2.jpg` },
    ] };
    const firstConfirmation = await command('90000000-0000-4000-8000-000000000032', 'confirm_cargo', confirmedPayload);
    const replayedConfirmation = await command('90000000-0000-4000-8000-000000000032', 'confirm_cargo', confirmedPayload);
    expect(replayedConfirmation).toEqual(firstConfirmation);
    expect((await db.query("select count(*)::integer count from trip_cargo_commands where action='confirm_cargo'")).rows)
      .toEqual([{ count: 1 }]);
    expect((await db.query("select count(*)::integer count from audit_log where action='confirm_cargo'")).rows)
      .toEqual([{ count: 1 }]);
    expect((await db.query('select count(distinct installed_evidence_id)::integer evidence_count from trip_cargo_seals')).rows)
      .toEqual([{ evidence_count: 2 }]);
    await db.query("insert into dispatch_events(tenant_id,dispatch_trip_id,event_type,payload,created_by) values($1,$2,'checklist_pre',$3::jsonb,$4)",
      [id.tenant, id.trip, JSON.stringify({ checked_items: [0,1,2,3,4,5,6,7] }), id.driverUser]);
    await command('90000000-0000-4000-8000-000000000033', 'mark_departed');
    await db.query("update dispatch_trips set status='completed'");
    await db.query("insert into dispatch_events(tenant_id,dispatch_trip_id,event_type,payload,created_by) values($1,$2,'checklist_post',$3::jsonb,$4)",
      [id.tenant, id.trip, JSON.stringify({ checked_items: [0,1,2,3,4] }), id.driverUser]);
    await expect(command('90000000-0000-4000-8000-000000000034', 'mark_returned')).rejects.toThrow('trip_cargo_seal_resolution_required');
    const seals = (await db.query<{ id: string; seal_number: string }>('select id,seal_number from trip_cargo_seals order by seal_number')).rows;
    const result = await command('90000000-0000-4000-8000-000000000035', 'resolve_seals', { seals: [{
      seal_id: seals[0].id, status: 'removed', reason: 'Lacre removido íntegro na conferência da base',
      evidence_path: `${id.tenant}/trip-cargo/${id.trip}/seal-return.jpg`,
    }, {
      seal_id: seals[1].id, status: 'removed', reason: 'Segundo lacre removido íntegro na conferência da base',
      evidence_path: `${id.tenant}/trip-cargo/${id.trip}/seal-return-2.jpg`,
    }] });
    expect(result.result).toMatchObject({ resolved_count: 2, remaining_installed: 0 });
    expect((await db.query('select status,resolved_by is not null actor,resolved_at is not null happened,resolution_evidence_id is not null evidence from trip_cargo_seals')).rows)
      .toEqual([{ status: 'removed', actor: true, happened: true, evidence: true }, { status: 'removed', actor: true, happened: true, evidence: true }]);
    await expect(db.query("update trip_cargo_seals set status='missing'")).rejects.toThrow('trip_cargo_seal_terminal_state_immutable');
    await command('90000000-0000-4000-8000-000000000036', 'mark_returned');
  });

  it('opens an operational divergence for a broken seal and blocks close until review', async () => {
    await command('90000000-0000-4000-8000-000000000040', 'accept', { vehicle_id: id.vehicle });
    const docs = (await db.query<{ id: string }>('select id from trip_cargo_document_checks')).rows.map(row => row.id);
    await command('90000000-0000-4000-8000-000000000041', 'confirm_cargo', { vehicle_checked: true, tie_down_confirmed: true,
      seals: ['LACRE-202'], documents: docs, loads: [{ load_id: id.load, volume_count: 10, pallet_count: 2, weight_kg: 100 }], evidence: [
        { kind: 'loading', path: `${id.tenant}/trip-cargo/${id.trip}/load.jpg` }, { kind: 'tie_down', path: `${id.tenant}/trip-cargo/${id.trip}/tie.jpg` },
        { kind: 'seal', path: `${id.tenant}/trip-cargo/${id.trip}/seal-install.jpg` },
      ], seal_evidence: [{ seal_number: 'LACRE-202', path: `${id.tenant}/trip-cargo/${id.trip}/seal-install.jpg` }] });
    await db.query("insert into dispatch_events(tenant_id,dispatch_trip_id,event_type,payload,created_by) values($1,$2,'checklist_pre',$3::jsonb,$4),($1,$2,'checklist_post',$5::jsonb,$4)",
      [id.tenant, id.trip, JSON.stringify({ checked_items: [0,1,2,3,4,5,6,7] }), id.driverUser, JSON.stringify({ checked_items: [0,1,2,3,4] })]);
    await command('90000000-0000-4000-8000-000000000042', 'mark_departed');
    await db.query("update dispatch_trips set status='completed'");
    const sealId = (await db.query<{ id: string }>('select id from trip_cargo_seals')).rows[0].id;
    await command('90000000-0000-4000-8000-000000000043', 'resolve_seals', { seals: [{ seal_id: sealId, status: 'broken',
      reason: 'Lacre encontrado rompido durante o retorno físico', evidence_path: `${id.tenant}/trip-cargo/${id.trip}/seal-broken.jpg` }] });
    await command('90000000-0000-4000-8000-000000000044', 'mark_returned');
    await db.query("insert into delivery_receipts values($1,$2,$3,$4,true,'received')", [id.receipt, id.tenant, id.trip, id.stop]);
    await actor(id.operator);
    await expect(rpc('select public.close_trip_cargo_v1($1,$2,null)', [id.tenant, id.trip])).rejects.toThrow('trip_cargo_divergences_pending');
    const divergence = (await db.query<{ id: string }>("select id from trip_cargo_divergences where divergence_kind='seal'")).rows[0].id;
    await rpc("select public.review_trip_cargo_divergence_v1($1,$2,'resolved','Ocorrência do lacre conferida pela operação')", [id.tenant, divergence]);
    const closed = await rpc<{ result: { status: string } }>('select public.close_trip_cargo_v1($1,$2,null) result', [id.tenant, id.trip]);
    expect(closed.result.status).toBe('closed');
  });
});
