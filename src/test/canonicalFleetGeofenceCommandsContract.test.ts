import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260916123000_canonical_fleet_geofence_commands.sql');
const page = read('src/pages/Geofences.tsx');

describe('canonical fleet geofence command contract', () => {
  it('routes every interactive fleet mutation through the canonical RPC', () => {
    expect(page).toContain("rpc('mutate_fleet_geofence_v1'");
    expect(page).toContain("action: 'mutate_fleet_geofence'");
    expect(page).toContain('prepareDurableOperatorCommand');
    expect(page).toContain('acknowledgeDurableOperatorCommand');
    expect(page).toContain('request_id: pending.requestId');
    expect(page).not.toContain('requestId: crypto.randomUUID()');
    expect(page).not.toMatch(/from\('geofences'\)\.update/);
    expect(page).not.toMatch(/from\('geofences'\)\.delete/);
  });

  it('removes direct authenticated writes and protects exact command replay', () => {
    expect(migration).toContain('revoke insert,update,delete on table public.geofences from authenticated');
    expect(migration).toContain('create policy geofences_active_tenant_read');
    expect(migration).toContain('drop policy if exists agvlog_update_authenticated');
    expect(migration).toContain("v_existing.action<>'mutate_fleet_geofence'");
    expect(migration).toContain("g.scope_kind='fleet' and g.dispatch_stop_id is null");
    expect(migration).toContain('grant execute on function public.mutate_fleet_geofence_v1(jsonb) to authenticated');
  });
});
