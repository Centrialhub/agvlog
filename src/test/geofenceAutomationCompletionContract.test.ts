import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260916152615_finalize_geofence_automation.sql');
const calibration = read('supabase/migrations/20260916154000_calibrate_geocoding_quality.sql');
const hardening = read('supabase/migrations/20260916162000_harden_geofence_runtime.sql');
const rls = read('supabase/migrations/20260916162500_consolidate_geofence_rls.sql');
const form = read('src/components/geofences/GeofenceFormDialog.tsx');
const page = read('src/pages/Geofences.tsx');
const picker = read('src/components/maps/LocationPicker.tsx');
const geocoder = read('supabase/functions/geocode-address/index.ts');

describe('completed geofence automation contract', () => {
  it('runs address resolution independently and only auto-resolves a trustworthy unique candidate', () => {
    expect(migration).toContain("'address-resolution-queue-every-minute'");
    expect(migration).toContain("'/functions/v1/process-address-resolution-queue'");
    expect(migration).toContain("coalesce(v_confidence,0)>=0.4");
    expect(calibration).toContain('coalesce(v_confidence,0)>=0.75');
    expect(migration).toContain("coalesce(v_accuracy,100000)<=250");
    expect(migration).toContain("'selection','automatic_unique_candidate'");
    expect(migration).toContain("v_status:=case when v_error is not null or v_count=0 then 'error' else 'ambiguous' end");
    expect(geocoder).toContain("endpoint.searchParams.set('street', structuredAddress.street)");
    expect(geocoder).toContain("endpoint.searchParams.set('postalcode', structuredAddress.postalcode)");
  });

  it('keeps the automated queue indexed and removes superseded permissive write surfaces', () => {
    expect(hardening).toContain('idx_address_resolution_audit_queue');
    expect(hardening).toContain('idx_address_resolution_queue_canonical');
    expect(hardening).toContain('idx_clients_canonical_address');
    expect(hardening).toContain('drop policy if exists agvlog_active_tenant_context on public.geofences');
    expect(hardening).toContain('from public,anon,authenticated');
    expect(hardening).toContain('to service_role');
    expect(rls).toContain('drop policy if exists "Admins can manage geofences"');
    expect(rls).toContain('for insert to authenticated');
    expect(rls).toContain('for update to authenticated');
    expect(rls).toContain('for delete to authenticated');
  });

  it('keeps client fleet fences projected from the canonical address source of truth', () => {
    expect(migration).toContain('add column if not exists auto_sync_address boolean not null default false');
    expect(migration).toContain('private.sync_fleet_geofences_for_canonical_v1');
    expect(migration).toContain('sync_fleet_geofences_from_canonical');
    expect(migration).toContain('sync_client_fleet_geofences');
    expect(migration).toContain("raise exception 'client_address_not_verified'");
    expect(migration).toContain("source_kind='address_geocoded'");
  });

  it('exposes opt-in client synchronization without allowing map edits to masquerade as automatic', () => {
    expect(form).toContain('Sincronizar endereço automaticamente');
    expect(form).toContain('auto_sync_address: category === \'client\' && autoSyncAddress');
    expect(form).toContain("if (nextLocation.source === 'map_selected') setAutoSyncAddress(false)");
    expect(page).toContain('◌ Aguardando endereço');
    expect(page).toContain('↻ Endereço sincronizado');
    expect(picker).toContain('if (!disabled) onChange(locationFromMap');
  });
});
