import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260910192455_complete_address_geocoding_automation.sql');
const worker = read('supabase/functions/process-address-resolution-queue/index.ts');
const geocoder = read('supabase/functions/geocode-address/index.ts');
const scheduler = read('supabase/functions/agvlog-schedule-tenants/index.ts');
const picker = read('src/components/maps/AddressResolutionPicker.tsx');
const page = read('src/pages/AddressResolution.tsx');

describe('automatic address resolution completion contract', () => {
  it('claims queue items with bounded leases and idempotent acknowledgement', () => {
    expect(migration).toContain('claim_address_resolution_queue_v2');
    expect(migration).toContain('for update of q skip locked');
    expect(migration).toContain('lease_expires_at');
    expect(migration).toContain('last_worker_request_key=v_request');
    expect(migration).toContain("current_user not in ('service_role','postgres')");
    expect(worker).toContain("admin.rpc('claim_address_resolution_queue_v2'");
    expect(worker).toContain("'ack_address_resolution_queue_item_v2'");
    expect(worker).toContain('address_hash: item.address_hash');
  });

  it('reuses the existing cache and quota through the authenticated geocoder boundary', () => {
    expect(worker).toContain("/functions/v1/geocode-address");
    expect(worker).toContain("'x-agvlog-cron-secret': cronSecret");
    expect(geocoder).toContain('isCronRequest(req, url, serviceKey)');
    expect(geocoder).toContain("admin.rpc('get_claimed_address_resolution_item_v1'");
    expect(geocoder).toContain(".from('address_geocoding_cache')");
    expect(geocoder).toContain("admin.rpc('consume_geocoding_quota_v1'");
  });

  it('runs from the canonical tenant scheduler without coupling it to SSX', () => {
    expect(scheduler).toContain('invokeAddressResolutionWorker(url, anonKey, cronSecret)');
    expect(scheduler).toContain('/functions/v1/process-address-resolution-queue');
    expect(scheduler).toContain('address_resolution: geocoding');
    const dispatcher = read('supabase/functions/agvlog-ssx-dispatcher/index.ts');
    expect(dispatcher).not.toContain('process-address-resolution-queue');
    expect(dispatcher).not.toContain('address_resolution:');
    expect(dispatcher).toContain('targets.length === 0');
  });

  it('reuses verified client coordinates and pauses derived delivery fences after an address change', () => {
    expect(migration).toContain('reuse_verified_client_geocode');
    expect(migration).toContain('apply_verified_client_geocode_to_stop');
    expect(migration).toContain("'selection','reused_verified_client'");
    expect(migration).toContain('get_routing_client_locations_v1');
    expect(migration).toContain('clients_pause_delivery_locations');
    expect(migration).toContain("location_verification_status='pending'");
    expect(migration).toContain('latitude=null,longitude=null');
    expect(migration).toContain('clients_resume_delivery_locations');
  });

  it('keeps manual map corrections in an immutable tenant-scoped audit', () => {
    expect(migration).toContain('create table if not exists public.address_resolution_audit_events');
    expect(migration).toContain('address_resolution_audit_events_immutable');
    expect(migration).toContain('manual_map_adjustment');
    expect(migration).toContain('public.is_tenant_admin(tenant_id)');
    expect(migration).toContain("v_kind='manual_map' and v_provider<>'leaflet_map'");
    expect(picker).toContain('draggable={!disabled}');
    expect(picker).toContain('dragend:');
    expect(picker).toContain("selection_kind: 'manual_map'");
    expect(page).toContain('previous_lat: selection.previous_lat');
  });
});
