import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917150200_bind_shortage_import_idempotency.sql',
  'utf8',
);

describe('shortage import identity and counts', () => {
  it('binds replay to request, file and canonical payload under separate locks', () => {
    expect(migration).toContain(':shortage-request:');
    expect(migration).toContain(':shortage-file:');
    expect(migration).toContain('batch.file_hash is distinct from _file_hash');
    expect(migration).toContain('batch.payload_hash is distinct from v_payload_hash');
    expect(migration).toContain('shortage_import_request_payload_mismatch');
    expect(migration).toContain('shortage_import_file_identity_mismatch');
  });

  it('requires declared rows to equal the received case array', () => {
    expect(migration).toContain('if _row_count <> jsonb_array_length(_cases) then');
    expect(migration).toContain('shortage_import_row_count_mismatch');
  });
});
