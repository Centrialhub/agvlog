import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration=readFileSync('supabase/migrations/20260917145600_bind_driver_monitor_command_idempotency.sql','utf8');

describe('driver monitor command replay identity',()=>{
  it('binds progress replay to payload, monitor and actor',()=>{
    expect(migration).toContain('driver_progress_request_payload_mismatch');
    expect(migration).toContain('v_existing.monitor_id<>v_monitor');
    expect(migration).toContain('v_existing.created_by is distinct from auth.uid()');
    expect(migration).toContain('v_existing.payload_hash<>v_hash');
  });
  it('binds forecast replay and keeps unsafe helpers private',()=>{
    expect(migration).toContain('driver_forecast_request_payload_mismatch');
    expect(migration).toContain('private.add_driver_forecast_unsafe_20260917');
    expect(migration).toContain('private.add_driver_progress_unsafe_20260917');
  });
});
