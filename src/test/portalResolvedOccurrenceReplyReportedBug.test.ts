import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('proteção de conversa de ocorrência resolvida', () => {
  it('oculta a ação no frontend e bloqueia o estado terminal no RPC', () => {
    const page = readFileSync('src/pages/portal/PortalOccurrences.tsx', 'utf8');
    const migration = readFileSync('supabase/migrations/20260921123000_idempotent_portal_occurrence_replies.sql', 'utf8');
    expect(page).toContain('o.can_reply && !o.resolved_at');
    expect(migration).toContain('if v_resolved_at is not null then');
    expect(migration).toContain('portal_occurrence_already_resolved');
  });
});
