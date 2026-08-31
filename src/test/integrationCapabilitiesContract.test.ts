import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("tenant integration capabilities", () => {
  const migration = read("supabase/migrations/20260829142707_restore_production_integration_capabilities.sql");

  it("creates fail-closed SSX/fiscal flags and independent kill switches", () => {
    for (const key of ["ssx_enabled", "fiscal_enabled", "ssx_kill_switch", "fiscal_kill_switch"]) {
      expect(migration).toContain(`('${key}'::text)`);
    }
    expect(migration).toContain("v_ssx_enabled and not v_ssx_kill_switch");
    expect(migration).toContain("v_fiscal_enabled and not v_fiscal_kill_switch");
    expect(migration).toContain("message = 'integration_capability_disabled'");
  });

  it("keeps capability reads tenant-scoped and backend assertions private", () => {
    expect(migration).toContain("auth.uid() is null or not public.is_tenant_member(_tenant_id)");
    expect(migration).toContain("Existing production RLS policies are already consolidated as agvlog_*");
    expect(migration).toContain("grant execute on function public.assert_tenant_integration_capability_v1(uuid, text) to service_role");
    expect(migration).toContain("revoke all on function public.assert_tenant_integration_capability_v1(uuid, text) from public, anon, authenticated");
  });

  it.each([
    "ssx-login",
    "ssx-poll-positions",
    "ssx-sync-telemetry",
    "ssx-sync-units",
    "ssx-insert-person",
    "ssx-insert-person-client",
    "ssx-diagnostic",
    "agvlog-pipeline-run",
  ])("guards the %s Edge Function before SSX use", (name) => {
    const source = read(`supabase/functions/${name}/index.ts`);
    expect(source).toContain("requireIntegrationCapability");
    expect(source).toMatch(/requireIntegrationCapability\([^\n]+["']ssx["']\)/);
  });

  it.each([
    "hub-fiscal-proxy",
    "emit-nfse",
    "cte-status-poll",
    "nfse-status-poll",
    "hub-fiscal-webhook-in",
    "cte-sefaz-callback",
  ])("guards the %s Edge Function before fiscal operations", (name) => {
    const source = read(`supabase/functions/${name}/index.ts`);
    expect(source).toContain("requireIntegrationCapability");
    expect(source).toMatch(/requireIntegrationCapability\([^\n]+["']fiscal["']\)/);
  });

  it("does not schedule disabled integration crons", () => {
    const cron = read("supabase/bootstrap/cron_jobs.sql");
    expect(cron).toContain("IF ssx_effective THEN");
    expect(cron).toContain("IF fiscal_effective THEN");
    expect(cron).toContain("'ssx_kill_switch'");
    expect(cron).toContain("'fiscal_kill_switch'");
  });

  it("gates fiscal routes and uses honest disabled copy", () => {
    const routes = read("src/app/AppRoutes.tsx");
    const unavailable = read("src/components/integrations/IntegrationUnavailable.tsx");
    expect(routes).toContain('<CapabilityGate capability="fiscal">');
    expect(unavailable).toContain("Integração em implantação");
    expect(unavailable).toContain("Nenhuma sincronização, emissão ou cancelamento será executado.");
  });
});
