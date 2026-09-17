import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve('supabase/migrations/20260917152500_proxy_and_audit_portal_downloads.sql'), 'utf8');
const edge = readFileSync(resolve('supabase/functions/portal-download-file/index.ts'), 'utf8');
const helper = readFileSync(resolve('src/lib/portal/downloadPortalFile.ts'), 'utf8');

describe('reported portal download authorization and audit bug', () => {
  it('removes direct authenticated access to RPCs that reveal persisted URLs', () => {
    expect(migration).toContain('revoke all on function public.portal_get_fiscal_file');
    expect(migration).toContain('public.portal_get_financial_title_file(uuid,uuid)');
    expect(migration).toContain('to service_role');
  });

  it('rechecks current grants through a metadata-only authorization RPC', () => {
    expect(migration).toContain('portal_authorize_download_v1');
    expect(migration).toContain('private.portal_read_fiscal_bundle');
    expect(migration).toContain('private.portal_read_financial_titles');
    expect(migration).not.toMatch(/portal_authorize_download_v1[\s\S]*?'url',v_file/);
  });

  it('streams through an authenticated no-store proxy and records the access trail', () => {
    expect(edge).toContain("requireActiveTenant(req, tenantId)");
    expect(edge).toContain("from('portal_download_audit').insert");
    expect(edge).toContain("outcome: 'served'");
    expect(edge).toContain("'Cache-Control': 'private, no-store, max-age=0'");
    expect(helper).toContain('/functions/v1/portal-download-file');
    expect(helper).toContain("'x-agvlog-tenant-id': body.tenant_id");
  });
});
