import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/20260830002627_enforce_trip_load_transit_invariant.sql'),
  'utf8',
);

describe('trip/load transit database invariant', () => {
  it('does not invent a repair status or departure time for historical inconsistencies', () => {
    expect(migration).not.toContain('inconsistent_trip_load_repair');
    expect(migration).toContain('Reconciliation is a separate, evidence-backed and audited operation');
    expect(migration).toContain('trip_start_requires_reconciliation');
  });

  it('guards every load writer with a database trigger', () => {
    expect(migration).toContain('create trigger enforce_load_transit_requires_started_trip');
    expect(migration).toContain('before insert or update of status, trip_id on public.loads');
    expect(migration).toContain("raise exception 'trip_must_be_started_before_load'");
  });

  it('keeps the canonical transition RPC behind the same started-trip check', () => {
    expect(migration).toContain('create or replace function public.transition_load_status_v1');
    expect(migration).toMatch(/trip\.status in \('in_transit', 'in_progress'\)/);
    expect(migration).toContain('trip.actual_start_at is not null');
    expect(migration).toMatch(/grant execute on function public\.transition_load_status_v1\(\s*uuid, uuid, text, text\s*\) to authenticated;/);
  });
  it('validates trip and relation changes at transaction commit', () => {
    expect(migration).toContain('enforce_trip_transit_graph_at_commit');
    expect(migration).toContain('enforce_link_transit_graph_at_commit');
    expect(migration).toContain('deferrable initially deferred');
  });
});
