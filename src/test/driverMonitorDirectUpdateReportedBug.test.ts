import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260917151800_block_direct_driver_monitor_updates.sql', 'utf8');
const command = readFileSync('supabase/migrations/20260901145247_make_driver_monitor_commands_recoverable.sql', 'utf8');

describe('reported direct driver monitor arrival update bug', () => {
  it('removes the REST update path while retaining the versioned audited command', () => {
    expect(migration).toContain('drop policy if exists drm_update');
    expect(migration).toContain('revoke update on table public.driver_route_monitors from anon,authenticated');
    expect(migration).toContain('as restrictive');
    expect(migration).toContain('using (false)');
    expect(command).toContain('create function public.apply_driver_monitor_command');
    expect(command).toContain('v_old.revision <> v_expected_revision');
    expect(command).toContain('insert into public.driver_monitoring_history');
    expect(command).toContain('driver_monitor_command_id');
  });
});
