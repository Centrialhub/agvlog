// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type ProviderItem = Record<string, unknown>;
type ProviderResult = {
  success: boolean;
  items: ProviderItem[];
  endpoint: string;
  statusCode: number;
  errorClass: string | null;
  errorMessage: string | null;
  successfulFormat: string | null;
  attempts: Array<Record<string, unknown>>;
};

const state = vi.hoisted(() => ({
  handler: null as null | ((request: Request) => Promise<Response>),
  account: {} as Record<string, any>,
  provider: {} as ProviderResult,
  providerCalls: 0,
  tableCalls: [] as string[],
  accountWrites: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  existingRows: {
    provider_units: [{ id: 'unit-old', external_code: 'old-code' }],
    vehicles: [{ id: 'vehicle-old', plate: 'OLD1234' }],
    vehicle_tracker_links: [{ id: 'link-old', provider_unit_id: 'unit-old' }],
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      state.tableCalls.push(table);
      if (table !== 'integration_accounts') throw new Error(`Unexpected table access: ${table}`);
      let update: Record<string, unknown> | null = null;
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data: state.account, error: null }),
        update: (value: Record<string, unknown>) => { update = value; return query; },
        then: (resolve: (value: unknown) => unknown) => {
          if (update) {
            state.accountWrites.push(update);
            Object.assign(state.account, update);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return query;
    },
  }),
}));
vi.mock('../../supabase/functions/_shared/cron-auth.ts', () => ({
  isCronRequest: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../supabase/functions/_shared/capabilities.ts', () => ({
  requireIntegrationCapability: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../supabase/functions/_shared/ssx-utils.ts', () => ({
  corsHeaders: {},
  readAccountConfig: (account: Record<string, any>) => ({
    token: 'synthetic-token', baseUrl: 'https://ssx.invalid', apiVersion: 'v3',
    requestTimeoutMs: 1000, settings: account.settings,
  }),
  buildSsxUrl: () => 'https://ssx.invalid/Tracking/PositionHistory/List',
  tryEndpointWithFallback: async () => { state.providerCalls++; return state.provider; },
  logIntegration: async (_client: unknown, details: Record<string, unknown>) => {
    state.audits.push(details);
  },
  logSsxCall: vi.fn(),
  normalizeTrackerItem: () => { throw new Error('No item can be normalized in these cases'); },
  buildAdminUrlCandidates: vi.fn(),
  pickVehicleIntegrationCode: vi.fn(),
  pickTrackerCodeFromVehicle: vi.fn(),
  pickPlate: vi.fn(),
  getAdminToken: vi.fn(),
  ADMIN_BODY_CANDIDATES: [],
  summarizeAttemptMatrix: vi.fn(),
  getTenantRole: vi.fn(),
  getWorkspaceRoleForAccount: vi.fn(),
  requireWorkspaceAccountContext: vi.fn(),
}));

const recentSync = new Date(Date.now() - 5 * 60_000).toISOString();
const oldRows = () => JSON.parse(JSON.stringify(state.existingRows));
const providerResult = (items: ProviderItem[], errorClass: string | null = null): ProviderResult => ({
  success: errorClass === null,
  items,
  endpoint: 'https://ssx.invalid/Tracking/PositionHistory/List',
  statusCode: 200,
  errorClass,
  errorMessage: errorClass,
  successfulFormat: 'v3_query_condition_array',
  attempts: [{
    endpoint: 'https://ssx.invalid/Tracking/PositionHistory/List',
    format: 'v3_query_condition_array', statusCode: 200, durationMs: 1,
    itemCount: items.length, errorClass, responsePreview: '',
  }],
});

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => ({
      SUPABASE_URL: 'https://db.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      SUPABASE_ANON_KEY: 'anon',
    } as Record<string, string>)[key] },
    serve: (handler: typeof state.handler) => { state.handler = handler; },
  });
  // Load the Deno handler under the runtime stub, outside the browser TS graph.
  const handlerPath = '../../supabase/functions/ssx-sync-units/index.ts';
  await import(handlerPath);
});
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
  state.account = {
    id: 'account-1', tenant_id: 'tenant-1', status: 'ok', last_error: null,
    token_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    settings: { administration_enabled: false, last_units_sync_at: recentSync },
  };
  state.provider = providerResult([]);
  state.providerCalls = 0;
  state.tableCalls = [];
  state.accountWrites = [];
  state.audits = [];
});

async function invoke(force: boolean): Promise<{ response: Response; body: Record<string, any> }> {
  if (!state.handler) throw new Error('Handler not loaded');
  const response = await state.handler(new Request('https://edge.invalid/ssx-sync-units', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ integration_account_id: 'account-1', force }),
  }));
  return { response, body: await response.json() };
}

describe('SSX unit discovery with absent stable identity', () => {
  it('rejects all vehicle rows without a stable code, keeping prior sync and mappings', async () => {
    const rowsBefore = oldRows();
    state.provider = providerResult([
      { IdTrackedUnitType: 1, TrackedUnit: 'Synthetic vehicle A', Plate: 'AAA1234' },
      { IdTrackedUnitType: 2, TrackedUnit: 'Synthetic person' },
      { IdTrackedUnitType: 1, TrackedUnit: 'Synthetic vehicle B', Plate: 'BBB1234' },
    ]);

    const { response, body } = await invoke(true);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      success: false, error_class: 'missing_stable_identity',
      vehicles_received: 3, skipped_non_vehicle: 1, skipped_missing_stable_code: 2,
    });
    expect(state.providerCalls).toBe(1);
    expect(state.account.settings.last_units_sync_at).toBe(recentSync);
    expect(state.accountWrites).toEqual([expect.objectContaining({ status: 'degraded' })]);
    expect(state.accountWrites[0]).not.toHaveProperty('settings');
    expect(state.tableCalls).toEqual(['integration_accounts', 'integration_accounts']);
    expect(state.existingRows).toEqual(rowsBefore);
    expect(state.audits).toEqual([expect.objectContaining({
      success: false, metadata: expect.objectContaining({
        method: 'tracking_discovery', skipped_missing_stable_code: 2, normalized_count: 0,
      }),
    })]);
  });

  it('returns the recorded failure within TTL without contacting the provider again', async () => {
    state.provider = providerResult([{ IdTrackedUnitType: 1, TrackedUnit: 'Synthetic vehicle' }]);
    expect((await invoke(true)).response.status).toBe(409);
    const providerCallsAfterFailure = state.providerCalls;

    const { response, body } = await invoke(false);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ success: false, error_class: 'missing_stable_identity' });
    expect(body.next_sync_available_at).toBeDefined();
    expect(body).not.toHaveProperty('retry_at');
    expect(state.providerCalls).toBe(providerCallsAfterFailure);
    expect(state.account.settings.last_units_sync_at).toBe(recentSync);
    expect(state.accountWrites).toHaveLength(1);

    expect((await invoke(true)).response.status).toBe(409);
    expect(state.providerCalls).toBe(providerCallsAfterFailure + 1);
  });

  it('accepts a genuinely empty Tracking result and advances the sync timestamp', async () => {
    state.provider = providerResult([], 'empty_response');
    const rowsBefore = oldRows();

    const { response, body } = await invoke(true);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, source_mode: 'tracking_discovery',
      vehicles_received: 0, normalized_count: 0, upserted: 0 });
    expect(state.account.settings.last_units_sync_at).not.toBe(recentSync);
    expect(state.account.status).toBe('ok');
    expect(state.tableCalls).toEqual(['integration_accounts', 'integration_accounts']);
    expect(state.existingRows).toEqual(rowsBefore);
    expect(state.audits).toEqual([expect.objectContaining({ success: true })]);
  });
});
