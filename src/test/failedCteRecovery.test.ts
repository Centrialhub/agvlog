import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapOutboundStatus } from '@/hooks/useCteMonitor';
import { mapSearchOutboundStatus } from '@/hooks/useCteSearch';

const migrationSource = () => readFileSync(
  'supabase/migrations/20260915194601_release_failed_cte_reservations.sql',
  'utf8',
);

const terminalPreflightCleanupSource = () => readFileSync(
  'supabase/migrations/20260916004029_allow_terminal_preflight_cte_cleanup.sql',
  'utf8',
);

describe('failed CT-e recovery', () => {
  it('exposes a provider-less timeout as a removable processing error', () => {
    expect(mapOutboundStatus('error', 'status_timeout', null)).toBe('processed_error');
    expect(mapSearchOutboundStatus('error', 'status_timeout', null)).toBe('sefaz_error');
  });

  it('does not expose a timeout with a Hub reference as a removable error', () => {
    expect(mapOutboundStatus('error', 'status_timeout', 'hub-document-id')).toBe('processed_error');
    expect(mapSearchOutboundStatus('error', 'status_timeout', 'hub-document-id')).toBe('sefaz_error');
  });

  it('keeps a definitive provider rejection visible as an error even with a Hub id', () => {
    expect(mapOutboundStatus('rejected', 'rejected', 'hub-document-id')).toBe('processed_error');
    expect(mapSearchOutboundStatus('rejected', 'rejected', 'hub-document-id')).toBe('sefaz_error');
  });

  it('releases the durable source reservation with the failed outbound row', () => {
    expect(migrationSource()).toMatch(/foreign key \(outbound_id\)[\s\S]*on delete cascade/i);
  });

  it('keeps release and deletion in one locked database operation', () => {
    const migration = migrationSource();
    const cleanup = terminalPreflightCleanupSource();
    const hook = readFileSync('src/hooks/useDeleteFailedCTe.ts', 'utf8');

    expect(hook).toContain("'delete_failed_cte_attempt_v1' as never");
    expect(hook).toContain("'status_timeout'");
    expect(hook).not.toContain('Boolean(realDoc.hub_document_id)');
    expect(cleanup).toMatch(/for update[\s\S]*delete from public\.fiscal_documents/i);
    expect(cleanup).toContain('_document.hub_document_id is not null');
    expect(cleanup).toContain("CTE_PREFLIGHT_FAILED");
    expect(cleanup).toContain('emission.provider_effect_id is not null');
    expect(migration).toMatch(/foreign key \(outbound_id\)[\s\S]*on delete cascade/i);
  });
});
