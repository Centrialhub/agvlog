import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260917145400_bind_driver_monitor_import_idempotency.sql', 'utf8');

describe('driver monitoring workbook idempotency identity', () => {
  it('serializes both request and fingerprint keys in deterministic order', () => {
    expect(migration).toContain("least('fingerprint:' || v_fingerprint, 'request:' || v_request::text)");
    expect(migration).toContain("greatest('fingerprint:' || v_fingerprint, 'request:' || v_request::text)");
    expect(migration.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
  });

  it('accepts replay only when both identifiers and the payload hash match', () => {
    expect(migration).toContain('v_existing.file_fingerprint is distinct from v_fingerprint');
    expect(migration).toContain('v_existing.request_id is distinct from v_request');
    expect(migration).toContain('v_existing.payload_hash <> v_payload_hash');
    expect(migration).toContain("raise exception 'driver_monitoring_request_payload_mismatch'");
  });
});
