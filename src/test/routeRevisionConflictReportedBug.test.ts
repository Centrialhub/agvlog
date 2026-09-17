import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260917144800_guard_route_template_revision.sql', 'utf8');
const dialog = readFileSync('src/components/routes/RouteDialog.tsx', 'utf8');

describe('route template optimistic concurrency', () => {
  it('sends the revision from the route snapshot being edited', () => {
    expect(dialog).toContain('expected_revision: editRoute?.revision ?? null');
  });

  it('locks the route, rejects a stale revision, and increments before replacing waypoints', () => {
    expect(migration).toContain('for update;');
    expect(migration).toContain('v_route.revision <> v_expected_revision');
    expect(migration).toContain("raise exception 'route_template_changed'");
    expect(migration).toContain("errcode = '40001'");
    expect(migration).toContain('revision = revision + 1');
    expect(migration.indexOf('revision = revision + 1')).toBeLessThan(migration.indexOf('delete from public.route_waypoints'));
  });

  it('requires a revision for edits while allowing new routes', () => {
    expect(migration).toContain("raise exception 'expected_route_revision_required'");
    expect(migration.indexOf('if v_id is null then')).toBeLessThan(migration.indexOf('if v_expected_revision is null then'));
  });
});
