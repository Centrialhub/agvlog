// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

const migration=readFileSync('supabase/migrations/20260910193642_driver_app_observability.sql','utf8');
const ids={tenant:'20000000-0000-4000-8000-000000000001',driver:'10000000-0000-4000-8000-000000000001',
  admin:'10000000-0000-4000-8000-000000000002',installation:'30000000-0000-4000-8000-000000000001'};
const counts={total:2,by_state:{queued:1,syncing:0,needs_attention:1},by_kind:{delivery:1,expense:0,arrival:1,departure:0,
  journey:0,checklist:0,occurrence:0,cargo:0}};
const payload={version:1,tenant_id:ids.tenant,installation_id:ids.installation,app_version:'1.0.0',build_hash:'a'.repeat(16),
  last_successful_sync_at:'2026-09-10T12:00:00Z',outbox:counts,document_conflicts:1,
  upload_failures:{total:3,affected_items:1,by_kind:{delivery:3,expense:0,arrival:0,departure:0,journey:0,checklist:0,occurrence:0,cargo:0}},
  geofence_errors:{permission_denied:0,location_unavailable:0,low_accuracy:1,outside_geofence:0,server_rejection:0}};
let db:PGlite;

async function asAuthenticated<T>(user:string,admin:boolean,sql:string,params:unknown[]=[]):Promise<T>{
  await db.exec('savepoint app_observability_call;set role authenticated');
  try{
    await db.query('select set_config($1,$2,true),set_config($3,$4,true)',
      ['request.jwt.claim.sub',user,'request.jwt.claim.admin',String(admin)]);
    const result=(await db.query<T>(sql,params)).rows[0];
    await db.exec('reset role;release savepoint app_observability_call');return result;
  }catch(error){await db.exec('rollback to savepoint app_observability_call;release savepoint app_observability_call');throw error;}
}

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema private;
    create type public.app_role as enum('owner','admin','operator','client','driver');
    create table auth.users(id uuid primary key);
    create table public.tenants(id uuid primary key);
    create table public.ssx_position_quarantine(tenant_id uuid,status text,reason text,occurrence_count integer,last_seen_at timestamptz);
    create table public.address_resolution_queue(tenant_id uuid,status text);
    create table public.vehicle_processing_queue(tenant_id uuid,last_error text,processed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function private.is_request_tenant_member(uuid) returns boolean language sql stable security definer set search_path=''
      as $$select auth.uid() is not null and $1='${ids.tenant}'::uuid$$;
    create function public.has_tenant_role(uuid,public.app_role) returns boolean language sql stable security definer set search_path=''
      as $$select auth.uid() is not null and $1='${ids.tenant}'::uuid and $2='driver'::public.app_role and auth.uid()='${ids.driver}'::uuid$$;
    create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql stable security definer set search_path=''
      as $$select auth.uid() is not null and current_setting('request.jwt.claim.admin',true)='true' and $1='${ids.tenant}'::uuid$$;
    insert into public.tenants values('${ids.tenant}');
    insert into auth.users values('${ids.driver}'),('${ids.admin}');
  `);
  await db.exec(migration);
  await db.exec('begin');
});
afterAll(async()=>{await db?.exec('rollback');await db?.close();});

describe('driver app observability database',()=>{
  it('publishes only a normalized snapshot for the authenticated actor',async()=>{
    const result=await asAuthenticated<{result:{accepted:boolean}}>(ids.driver,false,
      'select publish_driver_app_observability_v1($1::jsonb) result',[JSON.stringify(payload)]);
    expect(result.result.accepted).toBe(true);
    const row=(await db.query<{actor_id:string;outbox_total:number;document_conflicts:number;outbox_by_kind:Record<string,number>;upload_failures:{total:number}}>(
      'select actor_id,outbox_total,document_conflicts,outbox_by_kind,upload_failures from driver_app_observability_snapshots')).rows[0];
    expect(row).toMatchObject({actor_id:ids.driver,outbox_total:2,document_conflicts:1});
    expect(row.outbox_by_kind.delivery).toBe(1);
    expect(row.upload_failures.total).toBe(3);
  });

  it('rejects inconsistent or future telemetry and denies direct table reads',async()=>{
    await expect(asAuthenticated(ids.driver,false,'select publish_driver_app_observability_v1($1::jsonb)',
      [JSON.stringify({...payload,outbox:{...counts,total:99}})])).rejects.toThrow('driver_observability_inconsistent_counts');
    await expect(asAuthenticated(ids.driver,false,'select publish_driver_app_observability_v1($1::jsonb)',
      [JSON.stringify({...payload,last_successful_sync_at:'2999-01-01T00:00:00Z'})])).rejects.toThrow('driver_observability_future_sync_time');
    await expect(asAuthenticated(ids.driver,false,'select publish_driver_app_observability_v1($1::jsonb)',
      [JSON.stringify({...payload,upload_failures:{...payload.upload_failures,total:99}})])).rejects.toThrow('driver_observability_inconsistent_counts');
    await expect(asAuthenticated(ids.driver,false,'select * from driver_app_observability_snapshots')).rejects.toThrow(/permission denied/i);
  });

  it('normalizes an older installed PWA heartbeat without the new upload metric',async()=>{
    const olderPayload:Partial<typeof payload>={...payload};delete olderPayload.upload_failures;
    await expect(asAuthenticated(ids.driver,false,'select publish_driver_app_observability_v1($1::jsonb)',
      [JSON.stringify(olderPayload)])).resolves.toBeTruthy();
    expect((await db.query<{upload_failures:{total:number}}>('select upload_failures from driver_app_observability_snapshots')).rows[0]
      .upload_failures.total).toBe(0);
  });

  it('returns categorized aggregates only to an admin and supports opt-out deletion',async()=>{
    await asAuthenticated(ids.driver,false,'select publish_driver_app_observability_v1($1::jsonb)',[JSON.stringify(payload)]);
    await db.exec(`insert into ssx_position_quarantine values
      ('${ids.tenant}','open','invalid_gps',2,now()),('${ids.tenant}','open','ambiguous_unit',3,now());
      insert into address_resolution_queue values('${ids.tenant}','ambiguous');
      insert into vehicle_processing_queue values('${ids.tenant}','timeout',null);`);
    await expect(asAuthenticated(ids.driver,false,'select get_driver_app_observability_v1($1) result',[ids.tenant]))
      .rejects.toThrow('driver_observability_not_authorized');
    const admin=await asAuthenticated<{result:{total_devices:number;geofence_errors:{invalid_position:number;tracker_identity:number;
      address_resolution:number;processing:number};devices:Array<{installation_code:string;upload_failures:{total:number}}>}}>(ids.admin,true,
      'select get_driver_app_observability_v1($1) result',[ids.tenant]);
    expect(admin.result.total_devices).toBe(1);
    expect(admin.result.geofence_errors).toMatchObject({invalid_position:2,tracker_identity:3,address_resolution:1,processing:1});
    expect(admin.result.devices[0].installation_code).toBe(ids.installation.slice(0,8));
    expect(admin.result.devices[0].upload_failures.total).toBe(3);
    await asAuthenticated(ids.driver,false,'select disable_driver_app_observability_v1($1,$2)',[ids.tenant,ids.installation]);
    expect((await db.query<{count:number}>('select count(*)::int count from driver_app_observability_snapshots')).rows[0].count).toBe(0);
  });
});
