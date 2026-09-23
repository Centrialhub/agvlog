import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('criação idempotente de ocorrência do portal', () => {
  it('mantém request_id no formulário e protege o replay no banco', () => {
    const page = readFileSync('src/pages/portal/PortalOccurrences.tsx', 'utf8');
    const hook = readFileSync('src/hooks/portal/usePortalOccurrences.ts', 'utf8');
    const migration = readFileSync('supabase/migrations/20260921132500_link_portal_occurrences_to_fiscal_documents.sql', 'utf8');
    expect(page).toContain('createRequestIdRef.current ?? crypto.randomUUID()');
    expect(hook).toContain("supabase.rpc('create_client_occurrence_v3'");
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('portal_occurrence_request_id_mismatch');
    expect(migration).toContain('idempotency_key = v_key');
  });
});
