export type RpcPosition = Record<string, unknown> & { provider_payload_hash?: string };
export type RpcArgs = Record<string, unknown> & { _positions?: RpcPosition[] };

export const tenant = '31000000-0000-4000-8000-000000000001';
export const accountId = '32000000-0000-4000-8000-000000000001';
export const unitId = '33000000-0000-4000-8000-000000000001';
export const linkId = '34000000-0000-4000-8000-000000000001';
export const vehicleId = '35000000-0000-4000-8000-000000000001';
export const otherUnitId = '33000000-0000-4000-8000-000000000002';
export const otherLinkId = '34000000-0000-4000-8000-000000000002';
export const otherVehicleId = '35000000-0000-4000-8000-000000000002';

export const tables: Record<string, Record<string, unknown>[]> = {
  integration_accounts: [{
    id: accountId, tenant_id: tenant, provider: 'SSX', status: 'ok',
    token_expires_at: '2099-01-01T00:00:00.000Z',
  }],
  provider_units: [{
    id: unitId, tenant_id: tenant, integration_account_id: accountId,
    external_code: 'UNIT-QA', active: true, metadata: { id_tracked_unit: '123' },
  }],
  vehicle_tracker_links: [{
    id: linkId, tenant_id: tenant, provider_unit_id: unitId,
    vehicle_id: vehicleId, active: true, start_at: '2020-01-01T00:00:00.000Z', end_at: null,
  }],
};
