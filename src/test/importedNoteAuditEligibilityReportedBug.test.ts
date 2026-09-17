import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917145700_require_processed_imported_notes_for_audit.sql',
  'utf8',
);

describe('imported note audit eligibility', () => {
  it('requires every requested inbound note to still be in the legacy processed queue', () => {
    expect(migration).toContain("document.imported_note_status = 'processed'");
    expect(migration).toContain('if v_matched <> v_requested then');
    expect(migration).toContain('não pertencem à fila de importadas processadas');
  });

  it('keeps audit insertion and status clearing restricted to eligible rows', () => {
    expect(migration.match(/imported_note_status = 'processed'/g)).toHaveLength(3);
    expect(migration).toContain('if v_cleared <> v_requested then');
    expect(migration).toContain("using errcode = '40001'");
  });
});
