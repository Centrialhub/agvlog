import { expect, test } from '@playwright/test';

import { accounts, fixtureIds } from './fixtures/accounts';
import { passwordToken } from './fixtures/session';

test('@critical fiscal freight RPCs are callable before CT-e issuance', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The authenticated contract runs once per environment.');
  const session = await passwordToken(request, accounts.operator);
  const cases = [
    {
      name: 'create_fiscal_document_with_freight_v1',
      args: { _tenant_id: fixtureIds.tenantA, _document: {}, _breakdown: {} },
      code: '22023',
      message: 'invalid_fiscal_document_freight_create',
    },
    {
      name: 'update_fiscal_document_with_freight_v1',
      args: {
        _tenant_id: fixtureIds.tenantA, _document_id: null, _expected_updated_at: null,
        _document_patch: {}, _freight_patch: {}, _breakdown: {},
      },
      code: '22023',
      message: 'invalid_fiscal_document_freight_update',
    },
    {
      name: 'get_load_freight_context_v1',
      args: { _tenant_id: fixtureIds.tenantA, _load_id: crypto.randomUUID() },
      code: 'P0002',
      message: 'load_not_found',
    },
  ];

  for (const { name, args, code, message } of cases) {
    const response = await request.post(`${session.backendUrl}/rest/v1/rpc/${name}`, {
      headers: {
        apikey: session.publishableKey,
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      data: args,
    });
    expect(response.ok(), `${name} unexpectedly succeeded with invalid arguments`).toBe(false);
    const error = await response.json() as { code?: string; message?: string };
    expect(error.code, `${name} is missing or rejected before its validation guard`).toBe(code);
    expect(error.message).toContain(message);
  }
});
