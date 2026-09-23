import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('permissões por linha no portal', () => {
  it('projeta permissão efetiva no RPC e usa a flag em cada ação', () => {
    const migration = readFileSync('supabase/migrations/20260921124000_scope_portal_row_actions.sql', 'utf8');
    const pickups = readFileSync('src/pages/portal/PortalPickups.tsx', 'utf8');
    const occurrences = readFileSync('src/pages/portal/PortalOccurrences.tsx', 'utf8');
    expect(migration).toContain("''can_request_pickup'') as can_cancel");
    expect(migration).toContain("''can_open_occurrences'') as can_reply");
    expect(pickups).toContain("p.status === 'pendente' && p.can_cancel");
    expect(occurrences).toContain('o.can_reply && !o.resolved_at');
    expect(pickups).not.toContain('requestableClients.length === access.length');
    expect(occurrences).not.toContain('openableClients.length === access.length');
  });
});
