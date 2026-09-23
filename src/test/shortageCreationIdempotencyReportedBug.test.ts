import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/MerchandiseShortages.tsx', 'utf8');
const hook = readFileSync('src/hooks/useMerchandiseShortages.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260922024000_idempotent_shortage_case_creation.sql', 'utf8');

describe('merchandise shortage creation idempotency', () => {
  it('closes the immediate UI double-submit window', () => {
    expect(page).toContain('if (createLock.current || createCase.isPending) return');
    expect(page).toContain('createLock.current = true');
    expect(page).toContain('createLock.current = false');
    expect(page.match(/disabled=\{newCaseInvalid \|\| createCase\.isPending\}/g)).toHaveLength(2);
    expect(page).toContain('request_id: crypto.randomUUID()');
    expect(hook).toContain('request_id: string');
  });

  it('locks and replays a request before the unsafe allocator consumes another number', () => {
    const lock = migration.indexOf('perform pg_advisory_xact_lock');
    const replay = migration.indexOf('where tenant_id=_tenant_id and create_request_id=v_request');
    const create = migration.lastIndexOf('finance_private.create_merchandise_shortage_case_unsafe_20260917');
    expect(lock).toBeGreaterThan(-1);
    expect(replay).toBeGreaterThan(lock);
    expect(create).toBeGreaterThan(replay);
    expect(migration).toContain('merchandise_shortage_cases_tenant_create_request_uidx');
    expect(migration).toContain("(_payload-'request_id')::text");
    expect(migration).toContain("raise exception 'shortage_request_conflict'");
  });
});
