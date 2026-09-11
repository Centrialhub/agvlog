// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const tenantA = '10000000-0000-4000-8000-000000000001';
const tenantB = '10000000-0000-4000-8000-000000000002';

function token(activeTenantId: string) {
  const payload = Buffer.from(JSON.stringify({ sub: 'user', active_tenant_id: activeTenantId })).toString('base64url');
  return `header.${payload}.signature`;
}

beforeAll(() => {
  vi.stubGlobal('Deno', { env: { get: () => undefined } });
});

describe('Edge active tenant context', () => {
  it('accepts only when request body, transport header and signed claim agree', async () => {
    const { requireActiveTenant } = await import('../../supabase/functions/_shared/active-tenant.ts');
    const request = new Request('https://project.supabase.co/functions/v1/test', {
      headers: { Authorization: `Bearer ${token(tenantA)}`, 'x-agvlog-tenant-id': tenantA },
    });
    expect(requireActiveTenant(request, tenantA)).toBeNull();
  });

  it('rejects a forged header and a cross-tenant body', async () => {
    const { requireActiveTenant } = await import('../../supabase/functions/_shared/active-tenant.ts');
    const forged = new Request('https://project.supabase.co/functions/v1/test', {
      headers: { Authorization: `Bearer ${token(tenantA)}`, 'x-agvlog-tenant-id': tenantB },
    });
    expect(requireActiveTenant(forged, tenantB)?.status).toBe(409);

    const crossTenant = new Request('https://project.supabase.co/functions/v1/test', {
      headers: { Authorization: `Bearer ${token(tenantA)}`, 'x-agvlog-tenant-id': tenantA },
    });
    expect(requireActiveTenant(crossTenant, tenantB)?.status).toBe(409);
  });

  it('protects financial, fiscal and document gateways before service-role writes', () => {
    const root = process.cwd();
    for (const path of [
      ['finance-statement-verify'], ['secure-upload'], ['fiscal-certificate-manage'],
      ['hub-fiscal-credential-save'], ['hub-fiscal-proxy'], ['emit-nfse'],
      ['cte-status-poll'], ['nfse-status-poll'], ['extract-ort'], ['get-client-pod-signed-url'],
    ]) {
      const source = readFileSync(join(root, 'supabase', 'functions', path[0], 'index.ts'), 'utf8');
      expect(source, path[0]).toMatch(/requireActiveTenant|activeTenantFromVerifiedRequest/);
    }
  });

  it('binds direct SSX operations to the selected workspace account', () => {
    const root = process.cwd();
    for (const name of ['ssx-login','ssx-sync-units','ssx-poll-positions','ssx-diagnostic','ssx-sync-telemetry']) {
      const source = readFileSync(join(root, 'supabase', 'functions', name, 'index.ts'), 'utf8');
      expect(source, name).toContain('requireWorkspaceAccountContext');
    }
    for (const name of ['ssx-insert-person','ssx-insert-person-client']) {
      const source = readFileSync(join(root, 'supabase', 'functions', name, 'index.ts'), 'utf8');
      expect(source, name).toContain('requireActiveTenant');
      expect(source, name).toContain('integration_account_matches_tenant_workspace_v1');
    }
  });
});
