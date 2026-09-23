import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('geofence literal search regression', () => {
  it('escapes backslash, percent and underscore for both searchable fields', () => {
    const migration = readFileSync('supabase/migrations/20260922033000_escape_geofence_literal_search.sql', 'utf8');

    expect(migration).toContain("replace(replace(replace(search_text,'\\','\\\\'),'%','\\%'),'_','\\_')");
    expect(migration).toContain("coalesce(geofence.category,'general') ilike '%'||");
    expect(migration.match(/escape '\\'/g)).toHaveLength(1);
    expect(migration).toContain("$old$coalesce(geofence.category,'general') ilike '%'||search_text||'%'$old$");
    expect(migration).toContain("$new$coalesce(geofence.category,'general') ilike '%'||$new$ || escaped_search");
  });
});
