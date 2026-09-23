// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenant='10000000-0000-4000-8000-000000000001';
const actor='20000000-0000-4000-8000-000000000001';
const canonical='30000000-0000-4000-8000-000000000001';
const queue='40000000-0000-4000-8000-000000000001';
const hash='a'.repeat(64);
const migration=readFileSync('supabase/migrations/20260923145129_validate_manual_address_audit_evidence.sql','utf8');
let db:PGlite;

async function resolve(fields:Record<string,unknown>={}){
  const payload={tenant_id:tenant,request_id:randomUUID(),queue_id:queue,latitude:-19.91,longitude:-43.91,
    provider:'leaflet_map',selection_kind:'manual_map',previous_lat:-19.9,previous_lng:-43.9,
    accuracy_m:null,confidence:null,label:'Portaria conferida',...fields};
  return db.query<{result:Record<string,unknown>}>('select private.resolve_address_queue_item_v2($1::jsonb) result',[JSON.stringify(payload)]);
}

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create schema auth;create schema private;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function private.request_tenant_id() returns uuid language sql stable as
      $$select nullif(current_setting('test.active_tenant',true),'')::uuid$$;
    create function private.is_request_tenant_member(uuid) returns boolean language sql stable as $$select true$$;
    create function public.is_tenant_admin(uuid) returns boolean language sql stable as $$select true$$;
    create function public.stop_terminal_statuses() returns text[] language sql immutable as $$select array['delivered']::text[]$$;
    create table public.canonical_addresses(id uuid primary key,tenant_id uuid,address_hash text,normalized_address text,status text,
      latitude double precision,longitude double precision,provider text,accuracy_m double precision,
      confidence double precision,resolved_at timestamptz,resolved_by uuid,updated_at timestamptz);
    create table public.clients(id uuid,tenant_id uuid,canonical_address_id uuid,address_lat double precision,
      address_lng double precision,address_geocode_status text,address_geocode_provider text,
      address_geocode_accuracy_m double precision,address_geocode_confidence double precision,
      address_geocoded_at timestamptz,address_geocoded_by uuid,address_geocode_hash text,address_geocode_audit jsonb);
    create table public.dispatch_stops(id uuid,tenant_id uuid,canonical_address_id uuid,latitude double precision,
      longitude double precision,location_source text,location_address text,location_provider text,
      location_accuracy_m double precision,location_confidence double precision,location_resolved_at timestamptz,
      location_resolved_by uuid,location_verification_status text,location_invalidated_at timestamptz,
      location_audit jsonb,status text);
    create table public.address_resolution_queue(id uuid primary key,tenant_id uuid,entity_type text,entity_id uuid,
      canonical_address_id uuid,address_hash text,status text,candidates jsonb,resolved_lat double precision,
      resolved_lng double precision,resolved_provider text,resolved_accuracy_m double precision,
      resolved_confidence double precision,resolved_at timestamptz,resolved_by uuid,processed_at timestamptz,
      lease_token uuid,lease_expires_at timestamptz,resolution_kind text,resolution_details jsonb,updated_at timestamptz);
    create table public.operator_command_ledger(tenant_id uuid,request_id uuid,actor_id uuid,action text,
      entity_type text,entity_id uuid,payload_hash text,response jsonb,primary key(tenant_id,request_id));
    insert into public.canonical_addresses(id,tenant_id,address_hash,status) values('${canonical}','${tenant}','${hash}','pending');
    insert into public.address_resolution_queue(id,tenant_id,entity_type,entity_id,canonical_address_id,address_hash,status,candidates)
      values('${queue}','${tenant}','client','50000000-0000-4000-8000-000000000001','${canonical}','${hash}','ambiguous',
        '[{"latitude":-19.9,"longitude":-43.9,"accuracy_m":50,"confidence":0.8,"provider":"nominatim","label":"Sugestão"}]');
  `);
  await db.exec(migration);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
  await db.query("select set_config('test.active_tenant',$1,false)",[tenant]);
},15000);
afterAll(async()=>{await db?.close();});

describe('manual map audit evidence',()=>{
  it('rejects fabricated previous coordinates and impossible quality values without mutation',async()=>{
    await expect(resolve({previous_lat:1,previous_lng:2})).rejects.toThrow('manual_address_previous_point_mismatch');
    await expect(resolve({accuracy_m:-1})).rejects.toThrow('invalid_address_quality');
    await expect(resolve({confidence:1.5})).rejects.toThrow('invalid_address_quality');
    await expect(resolve({accuracy_m:10})).rejects.toThrow('invalid_manual_address_evidence');
    expect((await db.query('select status from public.address_resolution_queue where id=$1',[queue])).rows[0])
      .toEqual({status:'ambiguous'});
  });

  it('records an actual suggested point as the previous location',async()=>{
    await resolve();
    const row=(await db.query<{resolution_details:{previous_lat:number;previous_lng:number};status:string}>(
      'select status,resolution_details from public.address_resolution_queue where id=$1',[queue])).rows[0];
    expect(row.status).toBe('resolved');
    expect(row.resolution_details).toMatchObject({previous_lat:-19.9,previous_lng:-43.9});
  });
});
