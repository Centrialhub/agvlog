// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002',c='10000000-0000-4000-8000-000000000003';
const ua='20000000-0000-4000-8000-000000000001',ub='20000000-0000-4000-8000-000000000002',uc='20000000-0000-4000-8000-000000000003',ud='20000000-0000-4000-8000-000000000004';
const workspace='30000000-0000-4000-8000-000000000001';
let db:PGlite;

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema private;
    create type public.app_role as enum('owner','admin','operator','client','driver');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
    create function public.update_updated_at_column() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
    create table auth.users(id uuid primary key);
    create table public.tenants(id uuid primary key default gen_random_uuid(),name text not null,plan_key text not null default 'free',timezone text not null default 'America/Sao_Paulo',settings jsonb default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create table public.tenant_memberships(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),user_id uuid not null references auth.users(id),role public.app_role not null,active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(tenant_id,user_id));
    create function public.create_tenant_with_owner(text) returns uuid language sql as $$select gen_random_uuid()$$;
    create table public.clients(id uuid primary key,tenant_id uuid not null references public.tenants(id),company_name text not null,legal_name text,tax_id text,is_client boolean not null,is_supplier boolean not null,active boolean not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create table public.drivers(id uuid primary key,tenant_id uuid not null references public.tenants(id),name text not null,cpf text,doc text,email text,phone text,active boolean not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),user_id uuid references auth.users(id));
    create table public.employees(id uuid primary key,tenant_id uuid not null references public.tenants(id),name text not null,doc_cpf text,email text,phone text,status text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create table public.vehicles(id uuid primary key,tenant_id uuid not null references public.tenants(id),plate text not null,nickname text,active boolean not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create table public.positions_last(tenant_id uuid not null,vehicle_id uuid not null,lat double precision not null,lng double precision not null,speed double precision,heading double precision,captured_at timestamptz not null,received_at timestamptz not null,primary key(vehicle_id));
    create table public.vehicles_state(vehicle_id uuid primary key,tenant_id uuid not null,last_position_id uuid,lat double precision,lng double precision,speed double precision not null,heading double precision,movement_state text not null,last_movement_at timestamptz,last_position_at timestamptz,stopped_since timestamptz,stopped_duration_seconds integer,updated_at timestamptz not null default now());
    create table public.integration_accounts(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),provider text not null default 'SSX',base_url text not null,username text not null,password_encrypted text,hashauth text,hashcode text,token_cache text,status text not null,settings jsonb not null default '{}'::jsonb,last_login_at timestamptz,last_error text,token_expires_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    insert into auth.users values('${ua}'),('${ub}'),('${uc}'),('${ud}');
    insert into public.tenants(id,name) values('${a}','A'),('${b}','B'),('${c}','C');
    insert into public.tenant_memberships(tenant_id,user_id,role) values('${a}','${ua}','owner'),('${b}','${ub}','operator'),('${c}','${uc}','owner'),('${a}','${ud}','driver');
    insert into public.clients values('41000000-0000-4000-8000-000000000001','${a}','Cliente A','Cliente Legal','12.345.678/0001-90',true,true,true,now(),now()),('41000000-0000-4000-8000-000000000002','${b}','Mesmo Cliente','Cliente Legal','12345678000190',true,false,true,now(),now());
    insert into public.drivers(id,tenant_id,name,cpf,doc,email,phone,active,created_at,updated_at,user_id) values('42000000-0000-4000-8000-000000000001','${a}','Maria','123.456.789-01',null,'maria@test','1199',true,now(),now(),'${ud}');
    insert into public.employees values('43000000-0000-4000-8000-000000000001','${b}','Maria Silva','12345678901','maria@test','1199','active',now(),now());
    insert into public.vehicles values('44000000-0000-4000-8000-000000000001','${a}','ABC-1D23','Truck A',true,now(),now()),('44000000-0000-4000-8000-000000000002','${b}','abc1d23','Truck B',true,now(),now());
    insert into public.integration_accounts(id,tenant_id,provider,base_url,username,status) values('45000000-0000-4000-8000-000000000001','${a}','ssx','https://ssx.test','grupo-ab','ok');
  `);
  await db.exec(readFileSync('supabase/migrations/20260910125751_workspace_tenant_foundation.sql','utf8'));
  await db.query(`insert into public.workspaces(id,name) values('${workspace}','Grupo AB')`);
  await db.query(`update public.tenants set workspace_id='${workspace}' where id in('${a}','${b}')`);
  await db.exec(readFileSync('supabase/migrations/20260910132428_shared_master_data_foundation.sql','utf8'));
  await db.exec(`create or replace function private.user_can_access_tenant(_user uuid,_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.tenant_memberships m where m.user_id=_user and m.tenant_id=_tenant and m.active)$$;`);
  await db.exec(`
    create or replace function private.is_request_tenant_member(_tenant_id uuid) returns boolean language sql stable security definer set search_path='' as $$select private.user_can_access_tenant(auth.uid(),_tenant_id)$$;
    create or replace function public.is_tenant_admin(_tenant_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.tenant_memberships m where m.user_id=auth.uid() and m.tenant_id=_tenant_id and m.active and m.role in('owner','admin'))$$;
    insert into public.tenant_memberships(tenant_id,user_id,role) values('${b}','${ua}','admin');
  `);
  await db.exec(readFileSync('supabase/migrations/20260910133110_workspace_ssx_access_contract.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260910135800_workspace_ssx_account_management.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260910145706_harden_ssx_credentials_and_browser_contract.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260910153507_gate_ssx_administration_capability.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260910161442_expose_ssx_person_sync_settings.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260910162008_add_ssx_tracking_reference_catalog.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260910150914_add_ssx_position_quarantine.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260910141506_workspace_fleet_snapshot.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260910142232_synchronize_shared_master_projections.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260910152456_add_workspace_vehicle_position_reader.sql','utf8'));
  await db.exec(`
    create table public.dispatch_trips(
      id uuid primary key,tenant_id uuid not null references public.tenants(id),
      driver_id uuid,vehicle_id uuid
    );
    create table public.physical_journeys(
      id uuid primary key,workspace_id uuid not null references public.workspaces(id),
      workspace_person_id uuid,workspace_vehicle_id uuid
    );
    create table public.physical_journey_trips(
      physical_journey_id uuid not null references public.physical_journeys(id),
      workspace_id uuid not null references public.workspaces(id),
      source_tenant_id uuid not null references public.tenants(id),
      dispatch_trip_id uuid not null references public.dispatch_trips(id),trip_order integer not null
    );
    create table public.physical_journey_stops(
      physical_journey_id uuid not null references public.physical_journeys(id),
      workspace_id uuid not null references public.workspaces(id),
      source_tenant_id uuid not null references public.tenants(id)
    );
  `);
  await db.exec(readFileSync('supabase/migrations/20260910142818_merge_existing_tenant_workspaces.sql','utf8'));
},30_000);

afterAll(async()=>db?.close());

describe('shared master data foundation in PostgreSQL',()=>{
  it('deduplicates parties by tax id while retaining both tenant projections',async()=>{
    expect((await db.query(`select id from public.workspace_parties where workspace_id='${workspace}'`)).rows).toHaveLength(1);
    expect((await db.query(`select tenant_id,client_id from public.workspace_party_tenant_links where workspace_id='${workspace}'`)).rows).toHaveLength(2);
  });

  it('unifies driver and employee identity by CPF',async()=>{
    expect((await db.query(`select id from public.workspace_people where workspace_id='${workspace}'`)).rows).toHaveLength(1);
    const links=(await db.query<{driver_id:string|null;employee_id:string|null}>(`select driver_id,employee_id from public.workspace_person_tenant_links where workspace_id='${workspace}'`)).rows;
    expect(links).toHaveLength(4);expect(links.filter(link=>link.driver_id!==null)).toHaveLength(2);expect(links.filter(link=>link.employee_id!==null)).toHaveLength(2);
    expect((await db.query<{role:string}>(`select role from public.tenant_memberships where tenant_id='${b}' and user_id='${ud}'`)).rows).toEqual([{role:'driver'}]);
    expect((await db.query<{user_id:string}>(`select user_id from public.drivers where tenant_id='${b}' and cpf='123.456.789-01'`)).rows[0].user_id).toBe(ud);
  });

  it('unifies the physical truck by normalized plate',async()=>{
    const fleet=(await db.query<{plate_normalized:string}>(`select plate_normalized from public.workspace_vehicles where workspace_id='${workspace}'`)).rows;
    expect(fleet).toEqual([{plate_normalized:'ABC1D23'}]);
    expect((await db.query(`select vehicle_id from public.workspace_vehicle_tenant_links where workspace_id='${workspace}'`)).rows).toHaveLength(2);
  });

  it('returns one truck with the freshest telemetry across company projections',async()=>{
    await db.exec(`
      insert into public.positions_last values('${a}','44000000-0000-4000-8000-000000000001',-23.1,-46.1,20,90,now()-interval '5 minutes',now()-interval '5 minutes');
      insert into public.positions_last values('${b}','44000000-0000-4000-8000-000000000002',-23.2,-46.2,42,180,now(),now());
      insert into public.vehicles_state(vehicle_id,tenant_id,speed,movement_state,stopped_duration_seconds) values('44000000-0000-4000-8000-000000000002','${b}',42,'moving',0);
    `);
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${ub}'`);
    try{
      const rows=(await db.query<{id:string;source_vehicle_id:string;speed:number}>(`select id,source_vehicle_id,speed from public.list_workspace_fleet_snapshot_v1('${b}')`)).rows;
      expect(rows).toEqual([{id:'44000000-0000-4000-8000-000000000001',source_vehicle_id:'44000000-0000-4000-8000-000000000002',speed:42}]);
      const positions=(await db.query<{lat:number;lng:number}>(`select lat,lng from public.get_workspace_vehicle_position_v1('${b}','44000000-0000-4000-8000-000000000001')`)).rows;
      expect(positions).toEqual([{lat:-23.2,lng:-46.2}]);
    }finally{await db.exec('reset role;reset request.jwt.claim.sub');}
  });

  it('creates and updates shared client projections in every workspace tenant',async()=>{
    const id='46000000-0000-4000-8000-000000000001';
    await db.query(`insert into public.clients(id,tenant_id,company_name,legal_name,tax_id,is_client,is_supplier,active) values('${id}','${a}','Novo Cliente','Novo Cliente SA','98.765.432/0001-10',true,false,true)`);
    const bProjection=(await db.query<{id:string;company_name:string}>(`select id,company_name from public.clients where tenant_id='${b}' and tax_id='98.765.432/0001-10'`)).rows[0];
    expect(bProjection.company_name).toBe('Novo Cliente');
    await db.query(`update public.clients set company_name='Cliente Compartilhado' where id='${id}'`);
    expect((await db.query<{company_name:string}>(`select company_name from public.clients where id='${bProjection.id}'`)).rows[0].company_name).toBe('Cliente Compartilhado');
  });

  it('registers one shared SSX account for the workspace',async()=>{
    expect((await db.query<{migration_state:string}>(`select migration_state from public.workspace_ssx_accounts where workspace_id='${workspace}'`)).rows).toEqual([{migration_state:'ready'}]);
  });

  it('rotates the shared account from either tenant while retaining one registration',async()=>{
    const result=await db.query<{id:string}>(`select public.upsert_workspace_ssx_account_v1('${b}','45000000-0000-4000-8000-000000000001','https://new.ssx.test','rotated','enc:v1:test','auth','code','{}') id`);
    expect(result.rows[0].id).toBe('45000000-0000-4000-8000-000000000001');
    expect((await db.query<{username:string}>(`select username from public.integration_accounts where id='45000000-0000-4000-8000-000000000001'`)).rows[0].username).toBe('rotated');
    await db.query(`select public.upsert_workspace_ssx_account_v1('${a}','45000000-0000-4000-8000-000000000001','https://ssx.test','grupo-ab','enc:v1:test',null,null,'{}')`);
    expect((await db.query(`select 1 from public.workspace_ssx_accounts where workspace_id='${workspace}'`)).rows).toHaveLength(1);
  });

  it('returns the same safe SSX registration from either company',async()=>{
    await db.query(`update public.integration_accounts set settings='{"sync_units_backoff_until":"2026-09-10T15:00:00Z","internal_note":"never expose"}'::jsonb where id='45000000-0000-4000-8000-000000000001'`);
    for(const [actor,tenant] of [[ua,a],[ub,b]]){
      await db.exec(`set role authenticated;set request.jwt.claim.sub='${actor}'`);
      try{
        const rows=(await db.query<{id:string;migration_state:string;settings:Record<string,unknown>}>(`select id,migration_state,settings from public.get_workspace_ssx_accounts_v1('${tenant}')`)).rows;
        expect(rows).toEqual([{id:'45000000-0000-4000-8000-000000000001',migration_state:'ready',settings:{administration_enabled:false,hashauth_configured:false,hashcentral_configured:false,sync_units_backoff_until:'2026-09-10T15:00:00Z'}}]);
      }finally{await db.exec('reset role;reset request.jwt.claim.sub');}
    }
    expect((await db.query<{valid:boolean}>(`select public.integration_account_matches_tenant_workspace_v1('${b}','45000000-0000-4000-8000-000000000001') valid`)).rows[0].valid).toBe(true);
  });

  it('keeps the encrypted Administration token service-only and rejects tokens in settings',async()=>{
    await db.exec('set role service_role');
    try{
      await db.query(`select public.set_ssx_admin_token_cache_v1('45000000-0000-4000-8000-000000000001','enc:v1:0011:2233',now()+interval '1 hour')`);
      const cache=(await db.query<{cache:{token_ciphertext:string}}>(`select public.get_ssx_admin_token_cache_v1('45000000-0000-4000-8000-000000000001') cache`)).rows[0].cache;
      expect(cache.token_ciphertext).toBe('enc:v1:0011:2233');
    }finally{await db.exec('reset role');}

    await db.exec(`set role authenticated;set request.jwt.claim.sub='${ua}'`);
    try{
      await expect(db.query(`select public.get_ssx_admin_token_cache_v1('45000000-0000-4000-8000-000000000001')`)).rejects.toMatchObject({code:'42501'});
    }finally{await db.exec('reset role;reset request.jwt.claim.sub');}

    await expect(db.query(`update public.integration_accounts set settings='{"admin_token_cache":"plaintext"}'::jsonb where id='45000000-0000-4000-8000-000000000001'`)).rejects.toMatchObject({code:'23514'});
  });

  it('clears the Administration token when its explicit capability changes',async()=>{
    await db.query(`update public.integration_accounts set settings=jsonb_set(settings,'{administration_enabled}','true'::jsonb) where id='45000000-0000-4000-8000-000000000001'`);
    await db.exec('set role service_role');
    try{
      await db.query(`select public.set_ssx_admin_token_cache_v1('45000000-0000-4000-8000-000000000001','enc:v1:0011:5566',now()+interval '1 hour')`);
    }finally{await db.exec('reset role');}
    await db.query(`update public.integration_accounts set settings=jsonb_set(settings,'{administration_enabled}','false'::jsonb) where id='45000000-0000-4000-8000-000000000001'`);
    await db.exec('set role service_role');
    try{
      expect((await db.query<{cache:unknown}>(`select public.get_ssx_admin_token_cache_v1('45000000-0000-4000-8000-000000000001') cache`)).rows[0].cache).toBeNull();
    }finally{await db.exec('reset role');}
  });

  it('records minimized SSX quarantine envelopes through a service-only RPC',async()=>{
    const records=JSON.stringify([{
      reason:'invalid_gps',provider_position_id:'9001',tracked_unit_integration_code:'TRUCK-1',
      event_date:'2026-09-10T12:00:00Z',payload_hash:'a'.repeat(64),
      payload:{IdPosition:'9001',ValidGPS:false,TrackedUnitIntegrationCode:'TRUCK-1'},
    }]);
    await db.exec('set role service_role');
    try{
      const receipt=(await db.query<{receipt:{attempted:number;recorded:number}}>(`select public.record_ssx_position_quarantine_batch_v1('${a}','45000000-0000-4000-8000-000000000001',$1::jsonb) receipt`,[records])).rows[0].receipt;
      expect(receipt).toMatchObject({attempted:1,recorded:1});
      await db.query(`select public.record_ssx_position_quarantine_batch_v1('${a}','45000000-0000-4000-8000-000000000001',$1::jsonb)`,[records]);
      expect((await db.query<{occurrence_count:number}>('select occurrence_count from public.ssx_position_quarantine')).rows).toEqual([{occurrence_count:2}]);
    }finally{await db.exec('reset role');}

    await db.exec(`set role authenticated;set request.jwt.claim.sub='${ua}'`);
    try{
      await expect(db.query('select * from public.ssx_position_quarantine')).rejects.toMatchObject({code:'42501'});
      await expect(db.query(`select public.record_ssx_position_quarantine_batch_v1('${a}','45000000-0000-4000-8000-000000000001','[]'::jsonb)`)).rejects.toMatchObject({code:'42501'});
    }finally{await db.exec('reset role;reset request.jwt.claim.sub');}
  });

  it('atomically replaces minimal SSX reference catalogs through a service-only RPC',async()=>{
    await db.exec('set role service_role');
    try{
      const inserted=(await db.query<{count:number}>(`select public.replace_ssx_tracking_reference_catalog_v1(
        '45000000-0000-4000-8000-000000000001','telemetry',
        '[{"external_id":"1","name":"Ignição"},{"external_id":"2","name":"Odômetro"}]'::jsonb
      ) count`)).rows[0].count;
      expect(inserted).toBe(2);
      await db.query(`select public.replace_ssx_tracking_reference_catalog_v1(
        '45000000-0000-4000-8000-000000000001','telemetry',
        '[{"external_id":"2","name":"Odômetro total"}]'::jsonb
      )`);
    }finally{await db.exec('reset role');}
    expect((await db.query<{external_id:string;name:string}>(
      `select external_id,name from public.ssx_tracking_reference_catalog where resource_type='telemetry'`
    )).rows).toEqual([{external_id:'2',name:'Odômetro total'}]);

    await db.exec(`set role authenticated;set request.jwt.claim.sub='${ua}'`);
    try{
      await expect(db.query('select * from public.ssx_tracking_reference_catalog')).rejects.toMatchObject({code:'42501'});
      await expect(db.query(`select public.replace_ssx_tracking_reference_catalog_v1(
        '45000000-0000-4000-8000-000000000001','event','[]'::jsonb
      )`)).rejects.toMatchObject({code:'42501'});
    }finally{await db.exec('reset role;reset request.jwt.claim.sub');}
  });

  it('derives workspace ids and rejects mismatched writes',async()=>{
    await expect(db.query(`insert into public.vehicles(id,tenant_id,workspace_id,plate,active) values(gen_random_uuid(),'${a}','${c}','BAD1234',true)`)).rejects.toMatchObject({code:'23514'});
    await db.query(`insert into public.vehicles(id,tenant_id,plate,active) values(gen_random_uuid(),'${b}','NEW1234',true)`);
    expect((await db.query<{workspace_id:string}>(`select workspace_id from public.vehicles where plate='NEW1234'`)).rows[0].workspace_id).toBe(workspace);
  });

  it('allows workspace reads but rejects operator writes and outside workspaces',async()=>{
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${ub}'`);
    try{
      expect((await db.query('select id from public.workspace_vehicles')).rows).toHaveLength(2);
      expect((await db.query(`update public.workspace_vehicles set nickname='blocked' where plate_normalized='ABC1D23'`)).affectedRows).toBe(0);
      expect((await db.query<{nickname:string}>(`select nickname from public.workspace_vehicles where plate_normalized='ABC1D23'`)).rows[0].nickname).not.toBe('blocked');
    }finally{await db.exec('reset role;reset request.jwt.claim.sub');}
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${uc}'`);
    try{expect((await db.query('select id from public.workspace_vehicles')).rows).toHaveLength(0);}finally{await db.exec('reset role;reset request.jwt.claim.sub');}
  });

  it('refuses to merge workspaces with two distinct SSX registrations',async()=>{
    const sourceAccount=(await db.query<{id:string}>(`select public.upsert_workspace_ssx_account_v1('${c}',null,'https://other.ssx.test','other','enc:v1:other',null,null,'{}') id`)).rows[0].id;
    await expect(db.query(`select public.merge_existing_tenant_workspace_v1('${c}','${b}')`))
      .rejects.toMatchObject({code:'23505'});
    await db.query(`delete from public.workspace_ssx_accounts where integration_account_id='${sourceAccount}'`);
    await db.query(`delete from public.integration_accounts where id='${sourceAccount}'`);
  });

  it('deletes the registry and account atomically for an active-tenant admin',async()=>{
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${ua}'`);
    try{
      await db.query(`select public.delete_workspace_ssx_account_v1('${b}','45000000-0000-4000-8000-000000000001')`);
    }finally{await db.exec('reset role;reset request.jwt.claim.sub');}
    expect((await db.query(`select 1 from public.workspace_ssx_accounts where workspace_id='${workspace}'`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.integration_accounts where id='45000000-0000-4000-8000-000000000001'`)).rows).toHaveLength(0);
  });

  it('atomically merges an existing company workspace and rebuilds shared projections',async()=>{
    const sourceWorkspace=(await db.query<{workspace_id:string}>(`select workspace_id from public.tenants where id='${c}'`)).rows[0].workspace_id;
    const sourceClient='47000000-0000-4000-8000-000000000001';
    await db.query(`insert into public.clients(id,tenant_id,company_name,legal_name,tax_id,is_client,is_supplier,active) values('${sourceClient}','${c}','Cliente C','Cliente C Ltda','11.222.333/0001-44',true,false,true)`);

    const result=(await db.query<{result:{merged:boolean;workspace_id:string;tenants_moved:number}}>(
      `select public.merge_existing_tenant_workspace_v1('${c}','${b}') result`,
    )).rows[0].result;

    expect(result).toMatchObject({merged:true,workspace_id:workspace,tenants_moved:1});
    expect((await db.query<{workspace_id:string}>(`select workspace_id from public.tenants where id='${c}'`)).rows[0].workspace_id).toBe(workspace);
    expect((await db.query(`select 1 from public.workspaces where id='${sourceWorkspace}'`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.workspace_memberships where workspace_id='${workspace}' and user_id='${uc}' and active`)).rows).toHaveLength(1);
    expect((await db.query(`select tenant_id from public.clients where tax_id='11.222.333/0001-44' order by tenant_id`)).rows).toHaveLength(3);
    expect((await db.query(`select 1 from public.workspace_parties where workspace_id='${workspace}' and tax_id='11.222.333/0001-44'`)).rows).toHaveLength(1);
  });
});
