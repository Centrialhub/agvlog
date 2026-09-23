import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('legacy driver monitoring import replay',()=>{
  it('fails closed when the historical batch has no payload hash',()=>{
    const migration=readFileSync('supabase/migrations/20260921185651_reject_legacy_driver_monitor_replays.sql','utf8');
    expect(migration).toContain('v_existing.payload_hash is distinct from v_payload_hash');
    expect(migration).not.toContain('if v_existing.payload_hash is null then');
    expect(migration).not.toContain('where id = v_existing.id');
  });
});
