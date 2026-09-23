import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('cancelamento idempotente de coleta do portal', () => {
  it('preserva a tentativa no cliente e reconhece seu replay no banco', () => {
    const page = readFileSync('src/pages/portal/PortalPickups.tsx', 'utf8');
    const hook = readFileSync('src/hooks/portal/usePortalPickups.ts', 'utf8');
    const migration = readFileSync('supabase/migrations/20260921122500_audit_portal_pickup_cancellation.sql', 'utf8');
    expect(page).toContain('cancelRequestIdRef.current ?? crypto.randomUUID()');
    expect(hook).toContain('_request_id: args.request_id');
    expect(migration).toContain("if v_status = 'cancelada'");
    expect(migration).toContain('v_saved_request_id = _request_id');
    expect(migration).toContain('portal_cancel_request_id = _request_id');
  });
});
