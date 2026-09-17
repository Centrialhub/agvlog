import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260917151700_exclude_terminal_operations_loads.sql', 'utf8');

describe('reported operations load count bug', () => {
  it('excludes every terminal outcome and divergent rows before active and delayed aggregation', () => {
    const terminal = ['delivered', 'partial_delivery', 'returned', 'refused', 'failed', 'cancelled', 'divergent'];
    for (const status of terminal) expect(migration).toContain(`'${status}'`);
    expect(migration.indexOf("l.status not in(")).toBeLessThan(migration.indexOf('select\n    count(*)'));
    expect(migration).toContain('from scoped;');
  });
});
