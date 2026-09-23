import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('portal shipment occurrence link regression', () => {
  const detail = readFileSync('src/pages/portal/PortalShipmentDetail.tsx', 'utf8');
  const occurrences = readFileSync('src/pages/portal/PortalOccurrences.tsx', 'utf8');
  const hook = readFileSync('src/hooks/portal/usePortalOccurrences.ts', 'utf8');
  const migration = readFileSync(
    'supabase/migrations/20260921132500_link_portal_occurrences_to_fiscal_documents.sql',
    'utf8',
  );

  it('carries the document, client, and load context into the occurrence form', () => {
    expect(detail).toContain('documentId: documentId || data.context?.document_id');
    expect(detail).toContain('clientId: doc.client_id');
    expect(detail).toContain('loadId: load?.id');
    expect(occurrences).toContain("searchParams.get('documentId')");
    expect(occurrences).toContain('setOpen(true)');
  });

  it('persists and replay-checks the fiscal document through the v3 RPC', () => {
    expect(hook).toContain("supabase.rpc('create_client_occurrence_v3' as never");
    expect(hook).toContain('_fiscal_document_id: args.fiscal_document_id');
    expect(migration).toContain('v_existing.fiscal_document_id is distinct from _fiscal_document_id');
    expect(migration).toContain('fiscal_document_id = _fiscal_document_id');
    expect(migration).toContain('v_document_client_id is distinct from _client_id');
    expect(migration).toContain('portal_occurrence_document_load_mismatch');
  });
});
