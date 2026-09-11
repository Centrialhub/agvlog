import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260910211000_canonical_destination_geocoding_idempotency.sql');

describe('canonical destination idempotency release contract', () => {
  it('models destination addresses independently from clients and queues clientless stops', () => {
    expect(migration).toContain('create table public.canonical_addresses');
    expect(migration).toContain("entity_type in ('client','dispatch_stop')");
    expect(migration).toContain("'dispatch_stop',new.id");
    expect(migration).toContain('where s.client_id is null');
    expect(migration).toContain('canonical_address_id');
  });

  it('derives delivery-geofence references from stops without requiring a client foreign key', () => {
    expect(migration).toContain("if new.scope_kind='delivery' or new.dispatch_stop_id is not null");
    expect(migration).toContain('new.client_id:=v_stop.client_id');
    expect(migration).toContain('new.canonical_address_id:=v_stop.canonical_address_id');
    expect(migration).toContain("new.category='client' and new.client_id is not null");
    expect(migration).toContain("g.category='client' and g.client_id is null");
  });

  it('binds replay to tenant, actor and payload while removing non-idempotent frontend fallbacks', () => {
    expect(migration).toContain('primary key(tenant_id,request_id)');
    expect(migration).toContain('v_existing.actor_id<>v_actor');
    expect(migration).toContain("(_payload-'request_id')::text");
    expect(migration).toContain("raise exception 'operator_request_conflict'");
    expect(migration).toContain('revoke execute on function public.resolve_address_queue_item_v1');
    expect(migration).toContain('revoke execute on function public.upsert_geofence_v3');
    expect(migration).toContain('revoke execute on function public.upsert_geofence_v2');
    expect(migration).toContain('revoke execute on function public.review_trip_cargo_divergence_v1');
    expect(migration).toContain('revoke execute on function private.review_trip_cargo_divergence');
    expect(read('src/pages/AddressResolution.tsx')).toContain("resolve_address_queue_item_v2");
    expect(read('src/components/geofences/GeofenceFormDialog.tsx')).toContain("upsert_geofence_v4");
    expect(read('src/lib/driver/tripCargoCustody.ts')).toContain("review_trip_cargo_divergence_v2");
  });

  it('persists uncertain command identity for every operator mutation and only ACKs a matching response', () => {
    for (const path of [
      'src/pages/AddressResolution.tsx',
      'src/components/geofences/GeofenceFormDialog.tsx',
      'src/lib/driver/tripCargoCustody.ts',
    ]) {
      const source = read(path);
      expect(source).toContain('prepareDurableOperatorCommand');
      expect(source).toContain('acknowledgeDurableOperatorCommand');
      expect(source).toContain('request_id');
    }
    const outbox = read('src/lib/operator/durableOperatorCommand.ts');
    expect(outbox).toContain('tenantId');
    expect(outbox).toContain('actorId');
    expect(outbox).toContain('payloadHash');
    expect(outbox).not.toContain('payload: canonicalPayload');
  });

  it('keeps the new state behind RLS, explicit grants and immutable ledger rows', () => {
    expect(migration).toContain('alter table public.canonical_addresses enable row level security');
    expect(migration).toContain('alter table public.operator_command_ledger enable row level security');
    expect(migration).toContain('operator_command_ledger_immutable');
    expect(migration).toContain('canonical_destination_geocoding_idempotency_postcondition_failed');
    expect(migration).not.toContain('grant insert on table public.operator_command_ledger to authenticated');
  });

  it('binds every interactive surface and replay path to the signed active-tenant claim', () => {
    expect(migration).toContain('private.request_tenant_id()=tenant_id');
    expect(migration).toContain('private.request_tenant_id() is distinct from v_tenant');
    expect(migration).toContain('private.request_tenant_id() is distinct from _tenant_id');
    expect(migration).toContain('not private.is_request_tenant_member(v_tenant)');
    expect(migration).toContain('not private.is_request_tenant_member(_tenant_id)');
    expect(migration).toContain('drop policy if exists "Admins can manage geofences"');
    expect(migration).toContain('drop policy if exists address_resolution_queue_update');
    expect(migration).toContain("pg_get_expr(polqual,polrelid)");
  });
});
