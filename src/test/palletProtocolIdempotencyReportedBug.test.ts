import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/PalletReturns.tsx', 'utf8');
const hook = readFileSync('src/hooks/usePalletReturns.tsx', 'utf8');
const migration = readFileSync(
  'supabase/migrations/20260922017000_idempotent_pallet_protocol_creation.sql',
  'utf8',
);

describe('pallet protocol creation idempotency', () => {
  it('closes the immediate double-submit window in the UI', () => {
    expect(page).toContain('if (createLock.current || createMut.isPending) return');
    expect(page).toContain('createLock.current = true');
    expect(page).toContain('createLock.current = false');
    expect(page.match(/disabled=\{newProtocolInvalid \|\| createMut\.isPending/g)).toHaveLength(3);
    expect(page).toContain('request_id: crypto.randomUUID()');
    expect(hook).toContain('request_id: string');
  });

  it('serializes and replays the same server request without consuming another number', () => {
    const lock = migration.indexOf('perform pg_advisory_xact_lock');
    const replay = migration.indexOf("where tenant_id=_tenant_id and create_request_id=_request_id");
    const number = migration.indexOf('_number:=public.next_pallet_return_protocol_number');
    expect(lock).toBeGreaterThan(-1);
    expect(replay).toBeGreaterThan(lock);
    expect(number).toBeGreaterThan(replay);
    expect(migration).toContain('pallet_return_protocols_tenant_create_request_uidx');
    expect(migration).toContain("(_payload-'request_id')::text");
    expect(migration).toContain("raise exception 'pallet_protocol_request_conflict'");
  });
});
