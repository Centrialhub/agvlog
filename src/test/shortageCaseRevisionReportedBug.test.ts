import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917150330_guard_shortage_case_monotonic_revision.sql',
  'utf8',
);
const hook = readFileSync('src/hooks/useMerchandiseShortages.tsx', 'utf8');
const page = readFileSync('src/pages/MerchandiseShortages.tsx', 'utf8');

describe('shortage case optimistic concurrency', () => {
  it('locks the case and rejects a stale monotonic revision before mutation', () => {
    expect(migration).toContain('for update;');
    expect(migration).toContain('new.revision := old.revision + 1');
    expect(migration).toContain('v_case.revision <> v_expected_revision');
    expect(migration).toContain('shortage_case_revision_changed');
    expect(migration).toContain("using errcode = '40001'");
  });

  it('requires and forwards the rendered revision from every UI command', () => {
    expect(hook).toContain('expected_revision: number');
    expect(hook).toContain('expected_revision: args.expected_revision');
    expect(page.match(/expected_revision: c\.revision/g)).toHaveLength(5);
  });
});
