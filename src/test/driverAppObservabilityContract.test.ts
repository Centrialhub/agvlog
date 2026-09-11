import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const migration=readFileSync('supabase/migrations/20260910193642_driver_app_observability.sql','utf8');

describe('driver app observability database contract',()=>{
  it('keeps snapshots aggregate-only, opt-in and protected by RLS',()=>{
    expect(migration).toContain('create table public.driver_app_observability_snapshots');
    expect(migration).toContain('alter table public.driver_app_observability_snapshots enable row level security');
    expect(migration).toMatch(/revoke all on table public\.driver_app_observability_snapshots from public,anon,authenticated,service_role/);
    expect(migration).toContain('private.is_request_tenant_member(v_tenant)');
    expect(migration).toContain('actor_id=auth.uid()');
    expect(migration).toContain('disable_driver_app_observability_v1');
  });

  it('accepts only normalized counters and exposes no raw operational payload',()=>{
    expect(migration).toContain('driver_observability_valid_counts');
    expect(migration).toContain('driver_observability_inconsistent_counts');
    expect(migration).toContain('document_conflicts');
    expect(migration).toContain('upload_failures');
    expect(migration).toContain('geofence_errors');
    for(const forbidden of ['photo_path','document_id','delivery_id','latitude','longitude','last_error_message']){
      expect(migration).not.toContain(forbidden);
    }
  });

  it('restricts publishing to drivers and report reads to the tenant operational team',()=>{
    expect(migration).toMatch(/revoke all on function public\.publish_driver_app_observability_v1\(jsonb\) from public,anon,authenticated,service_role/);
    expect(migration).toContain('grant execute on function public.publish_driver_app_observability_v1(jsonb) to authenticated');
    expect(migration).toContain("not public.has_tenant_role(v_tenant,'driver'::public.app_role)");
    expect(migration).toContain('not public.is_tenant_operator_or_admin(_tenant_id)');
    expect(migration).toMatch(/revoke all on function public\.get_driver_app_observability_v1\(uuid\) from public,anon,authenticated,service_role/);
  });
});
