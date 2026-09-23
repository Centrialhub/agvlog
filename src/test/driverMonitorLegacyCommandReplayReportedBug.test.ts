import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('legacy driver monitor command replay',()=>{
  it('rewrites both wrappers to reject a null stored hash',()=>{
    const migration=readFileSync('supabase/migrations/20260921192320_reject_legacy_driver_monitor_command_replays.sql','utf8');
    expect(migration).toContain('public.add_driver_progress_v1(jsonb)');
    expect(migration).toContain('public.add_driver_forecast_v1(jsonb)');
    expect(migration).toContain('v_existing.payload_hash is distinct from v_hash');
    expect(migration).toContain('legacy_driver_monitor_replay_guard_not_rewritten');
  });
});
