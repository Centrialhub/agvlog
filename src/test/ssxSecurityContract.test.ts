// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

let normalizeSsxBaseUrl: (value: unknown) => string;
let getAdminToken: (config: any, supabase: any, integrationAccountId: string) => Promise<{token:string|null;error:string|null}>;

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: {
      get: (name: string) => name === 'SSX_ALLOWED_ORIGINS'
        ? 'https://ssx-hml.example.test'
        : undefined,
    },
  });
  ({ normalizeSsxBaseUrl, getAdminToken } = await import('../../supabase/functions/_shared/ssx-utils.ts'));
});

describe('SSX security contract', () => {
  it('allows only the official origin or an explicit server-side allowlist', () => {
    expect(normalizeSsxBaseUrl('https://integration.systemsatx.com.br/'))
      .toBe('https://integration.systemsatx.com.br');
    expect(normalizeSsxBaseUrl('https://ssx-hml.example.test'))
      .toBe('https://ssx-hml.example.test');

    for (const value of [
      'http://integration.systemsatx.com.br',
      'https://integration.systemsatx.com.br.attacker.test',
      'https://user:password@integration.systemsatx.com.br',
      'https://integration.systemsatx.com.br/redirect',
      'https://127.0.0.1',
    ]) {
      expect(() => normalizeSsxBaseUrl(value)).toThrow('SSX_BASE_URL_NOT_ALLOWED');
    }
  });

  it('keeps the URL fixed in the UI and validates it again on the server', () => {
    const settings = readFileSync('src/pages/Settings.tsx', 'utf8');
    const upsert = readFileSync('supabase/functions/agvlog-integration-upsert/index.ts', 'utf8');
    expect(settings).toContain("const SSX_BASE_URL = 'https://integration.systemsatx.com.br'");
    expect(settings).toMatch(/name="base_url"[^>]+readOnly[^>]+disabled/);
    expect(settings).not.toContain('setBaseUrl');
    expect(upsert).toContain('normalizeSsxBaseUrl(base_url)');
    expect(upsert).toContain('SSX_BASE_URL_NOT_ALLOWED');
  });

  it('stores the Administration token only in an encrypted service-only cache', () => {
    const migration = readFileSync(
      'supabase/migrations/20260910145706_harden_ssx_credentials_and_browser_contract.sql',
      'utf8',
    );
    const shared = readFileSync('supabase/functions/_shared/ssx-utils.ts', 'utf8');
    expect(migration).toContain('create table if not exists private.ssx_admin_token_cache');
    expect(migration).toContain('token_ciphertext text not null');
    expect(migration).toContain('grant execute on function public.get_ssx_admin_token_cache_v1(uuid) to service_role');
    expect(migration).toContain("settings = settings\n  - 'admin_token_cache'");
    expect(shared).toContain('encryptAesGcm(token, encryptionKey)');
    expect(shared).not.toMatch(/settings:\s*\{[^}]*admin_token_cache/s);
  });

  it('returns a whitelisted browser DTO and redacts upstream response bodies', () => {
    const migration = readFileSync(
      'supabase/migrations/20260910145706_harden_ssx_credentials_and_browser_contract.sql',
      'utf8',
    );
    const shared = readFileSync('supabase/functions/_shared/ssx-utils.ts', 'utf8');
    expect(migration).toContain("'sync_units_backoff_until', account.settings -> 'sync_units_backoff_until'");
    expect(migration).not.toContain('account.settings,\n    account.last_login_at');
    expect(shared).toContain('[response body redacted;');
    expect(shared).not.toContain('(result.text || result.networkError || "").substring');
  });

  it('fails closed before obtaining an Administration token without explicit opt-in', async () => {
    const rpc = vi.fn();
    const result = await getAdminToken({
      settings: { administration_enabled: false },
      token: 'tracking-token',
    }, { rpc }, crypto.randomUUID());
    expect(result).toEqual({ token: null, error: 'SSX_ADMINISTRATION_DISABLED' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('keeps Tracking independent and labels PositionHistory discovery as partial', () => {
    const sync = readFileSync('supabase/functions/ssx-sync-units/index.ts', 'utf8');
    const diagnostic = readFileSync('supabase/functions/ssx-diagnostic/index.ts', 'utf8');
    const upsert = readFileSync('supabase/functions/agvlog-integration-upsert/index.ts', 'utf8');
    const settings = readFileSync('src/pages/Settings.tsx', 'utf8');
    const migration = readFileSync(
      'supabase/migrations/20260910153507_gate_ssx_administration_capability.sql',
      'utf8',
    );

    expect(sync).toContain('settings.administration_enabled === true');
    expect(sync).toContain('"tracking_discovery"');
    expect(sync).toContain('catalog_complete: usedMethod === "administration"');
    expect(sync).toContain('isVehicleTrackedUnit(raw)');
    expect(sync).toContain('pickTrackedUnitIntegrationCode(raw)');
    expect(sync).not.toContain('legacy_fallback');
    expect(sync).not.toContain('fetchUnitsTrackingFallback');
    expect(diagnostic).toContain('SSX_ADMINISTRATION_DISABLED');
    expect(diagnostic).toContain('nenhuma chamada foi realizada');
    expect(upsert).toContain('SSX_HASHAUTH_REQUIRED');
    expect(upsert).toContain('SSX_HASHCENTRAL_REQUIRED');
    expect(settings).toContain('Administration contratado e autorizado');
    expect(migration).toContain("'administration_enabled'");
    expect(migration).toContain("after update of base_url, username, password_encrypted, hashauth, hashcode, settings");
  });

  it('dispatches every eligible workspace through a cron-only leased worker', () => {
    const dispatcher = readFileSync(
      'supabase/functions/agvlog-ssx-dispatcher/index.ts',
      'utf8',
    );
    const dispatcherMigration = readFileSync(
      'supabase/migrations/20260910154919_add_ssx_workspace_dispatcher.sql',
      'utf8',
    );
    const config = readFileSync('supabase/config.toml', 'utf8');

    expect(dispatcher).toContain('isCronRequest(req, supabaseUrl, serviceKey)');
    expect(dispatcher).toContain('claim_workspace_ssx_dispatch_v1');
    expect(dispatcher).toContain('ack_workspace_ssx_dispatch_v1');
    expect(dispatcher).toContain('Promise.all(targets.map');
    expect(dispatcher).not.toContain('details:');
    expect(dispatcherMigration).toContain('for update of registry skip locked');
    expect(dispatcherMigration).toContain("to service_role");
    expect(dispatcherMigration).not.toContain("'anon_key'");
    expect(config).toMatch(/\[functions\.agvlog-ssx-dispatcher\]\s+verify_jwt = false/);
  });

  it('reconciles real people and blocks the former client-as-person mapping', () => {
    const person = readFileSync('supabase/functions/ssx-insert-person/index.ts', 'utf8');
    const clientBoundary = readFileSync(
      'supabase/functions/ssx-insert-person-client/index.ts',
      'utf8',
    );
    const ingestion = readFileSync('src/pages/Ingestion.tsx', 'utf8');

    expect(person).toContain('/Tracking/Person/ListPerson');
    expect(person).toContain('/Tracking/Person/ListPersonRole');
    expect(person).toContain('/Tracking/Person/InsertPerson');
    expect(person).toContain('/Tracking/Person/UpdatePerson');
    expect(person).toContain('returnedCode !== driver.id');
    expect(person).toContain('provider_person_sync_status: status');
    expect(person).not.toMatch(/parsed\?\.(Id|id|PersonId|personId)/);
    expect(clientBoundary).toContain('SSX_CLIENT_REQUIRES_ADMINISTRATION_CAPABILITY');
    expect(clientBoundary).not.toContain('/Tracking/Person/InsertPerson');
    expect(ingestion).not.toContain("functions.invoke<SsxInsertPersonResponse>('ssx-insert-person-client'");
    const upsert = readFileSync('supabase/functions/agvlog-integration-upsert/index.ts', 'utf8');
    const settings = readFileSync('src/pages/Settings.tsx', 'utf8');
    expect(upsert).toContain('person_role_integration_code');
    expect(settings).toContain('Cargo da pessoa');
  });

  it('uses the exact OpenAPI route and no request body for the telemetry catalog', () => {
    const telemetry = readFileSync('supabase/functions/ssx-sync-telemetry/index.ts', 'utf8');
    const diagnostic = readFileSync('supabase/functions/ssx-diagnostic/index.ts', 'utf8');
    expect(telemetry).toContain('buildTrackingUrl(config.baseUrl, spec.path)');
    expect(telemetry).toContain('ssxPost(endpoint, config.token, null');
    expect(telemetry).not.toContain('buildSsxUrlCandidates');
    expect(diagnostic).toContain('buildTrackingUrl(config.baseUrl, "/Tracking/Telemetry/List")');
    for (const route of [
      '/Tracking/Actuator/List',
      '/Tracking/Event/List',
      '/Tracking/Sensor/List',
      '/Tracking/Telemetry/List',
    ]) expect(telemetry).toContain(route);
    expect(telemetry).toContain('replace_ssx_tracking_reference_catalog_v1');
  });

  it('accepts only the published login token field and never falls back from PositionHistory v3', () => {
    const login = readFileSync('supabase/functions/ssx-login/index.ts', 'utf8');
    const shared = readFileSync('supabase/functions/_shared/ssx-utils.ts', 'utf8');
    expect(login).toContain('typeof parsed.AccessToken === "string"');
    expect(login).not.toMatch(/parsed\.(access_token|Token|token)/);
    expect(shared).toContain('SSX_POSITION_V3_REQUIRED');
    expect(shared).toContain('return [`${base}/v3/Tracking/PositionHistory/List`]');
  });
});
