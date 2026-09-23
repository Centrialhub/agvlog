import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260921132000_preserve_retired_pods_in_portal_timeline.sql',
  'utf8',
);

describe('portal retired POD timeline regression', () => {
  it('reads both received and validated events from all tenant-scoped POD versions', () => {
    expect(migration).toContain('p.received_at IS NOT NULL');
    expect(migration).toContain('p.validated_at IS NOT NULL');
    expect(migration.match(/FROM public\.proof_of_delivery p/g)).toHaveLength(2);
    expect(migration.match(/p\.tenant_id = _tenant AND p\.fiscal_document_id = _fd\.id/g)).toHaveLength(4);
  });

  it('fails the migration if the expected timeline contract is no longer present', () => {
    expect(migration).toContain('portal_shipment_detail_pod_timeline_contract_not_found');
    expect(migration).toContain('position(v_received_branch in v_function) = 0');
    expect(migration).toContain('position(v_validated_branch in v_function) = 0');
  });
});
