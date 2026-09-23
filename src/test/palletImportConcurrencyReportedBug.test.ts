import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { palletImportRequestId } from '@/lib/palletReturns/palletReturnImporter';

const page = readFileSync('src/pages/PalletReturns.tsx', 'utf8');
const hook = readFileSync('src/hooks/usePalletReturns.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260922017000_idempotent_pallet_protocol_creation.sql', 'utf8');

describe('concurrent pallet imports', () => {
  it('derives a stable tenant-scoped UUID from the imported content', async () => {
    const first = await palletImportRequestId('tenant-a', 'supplier#date#items');
    const replay = await palletImportRequestId('tenant-a', 'supplier#date#items');
    const otherTenant = await palletImportRequestId('tenant-b', 'supplier#date#items');
    expect(first).toBe(replay);
    expect(first).not.toBe(otherTenant);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('uses that UUID in the locked create command and disables repeated clicks', () => {
    expect(hook).toContain('await palletImportRequestId(currentTenant.id, importedKey)');
    expect(hook).toContain('request_id: requestId');
    expect(page).toContain('disabled={previewList.length === 0 || importMut.isPending}');
    expect(migration).toContain('perform pg_advisory_xact_lock');
    expect(migration).toContain('create_request_id=_request_id');
  });
});
