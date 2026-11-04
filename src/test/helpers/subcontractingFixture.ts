import { contractorFixture } from './contractorCteFixture';
import type { CteSubcontractingSelection } from '@/lib/fiscal/cteSubcontracting';
export function subcontractingFixture(tenant = '10000000-0000-4000-8000-000000000001'): CteSubcontractingSelection {
  return {
    source: { id: 'aa000000-0000-4000-8000-000000000001', tenant_id: tenant, access_key: contractorFixture.access_key,
      environment: 'production', source_format: 'pdf', document: structuredClone(contractorFixture),
      original_path: `${tenant}/original.pdf`, original_sha256: 'a'.repeat(64), original_size: 31,
      original_name: 'dacte-qa.pdf', created_by: '20000000-0000-4000-8000-000000000001', created_at: '2026-11-03T12:00:00Z' },
    originName: 'Montes Claros', destinationName: 'São Paulo', confirmed: true,
  };
}
