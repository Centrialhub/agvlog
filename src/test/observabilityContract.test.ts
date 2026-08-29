import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("release observability contract", () => {
  it("captures browser failures with a stable correlation id and bounded schema", () => {
    const main = read("src/main.tsx");
    const telemetry = read("src/lib/observability/frontendTelemetry.ts");
    const collector = read("supabase/functions/frontend-error-report/index.ts");
    const performance = read("src/lib/observability/performanceTelemetry.ts");

    expect(main).toContain("installGlobalErrorTelemetry()");
    expect(telemetry).toContain('functions.invoke("frontend-error-report"');
    expect(telemetry).toContain('headers: { "x-correlation-id": correlationId }');
    expect(collector).toContain("payload_too_large");
    expect(collector).toContain("rate_limited");
    expect(collector).toContain("tenant_access_denied");
    expect(collector).toContain("safeMessage(body.message)");
    expect(collector).not.toContain("console.error(body");
    for (const metric of ["LCP", "CLS", "INP", "TTFB"]) expect(performance).toContain(metric);
    expect(collector).toContain('body.kind === "web_vital"');
  });

  it("keeps telemetry private and automatically expires old events", () => {
    const migration = read("supabase/migrations/20260828212454_application_error_telemetry.sql").toLowerCase();
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.application_error_events from public, anon, authenticated");
    expect(migration).toContain("interval '30 days'");
    expect(migration).toContain("agvlog-application-error-retention");
    const vitalsMigration = read("supabase/migrations/20260828214259_application_web_vitals.sql").toLowerCase();
    expect(vitalsMigration).toContain("application_web_vitals");
    expect(vitalsMigration).toContain("interval '30 days'");
  });
});
