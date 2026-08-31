import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('SSX reintegration readiness', () => {
  it('fails closed at the pipeline orchestrator before processing accounts', () => {
    const pipeline = read('supabase', 'functions', 'agvlog-pipeline-run', 'index.ts');
    const guardAt = pipeline.indexOf('requireIntegrationCapability(supabase, tenant_id, "ssx")');
    const accountQueryAt = pipeline.indexOf('.from("integration_accounts")');

    expect(guardAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(accountQueryAt);
    expect(pipeline).toContain('invalid pipeline_mode');
  });

  it('allows credential preparation while external SSX actions stay disabled', () => {
    const settings = read('src', 'pages', 'Settings.tsx');
    expect(settings).toContain('<IntegrationSection ssxEnabled={ssxEnabled} />');
    expect(settings).toContain('SSX desativado — preparação segura disponível');
    expect(settings).toContain('disabled={!ssxEnabled || loginMutation.isPending}');
    expect(settings).toContain('onClick={() => { setEditingAccount(acc); setDialogOpen(true); }}');
  });

  it('documents staged activation, fresh telemetry proof, observation, and rollback', () => {
    const runbook = read('docs', 'production-runbook.md');
    expect(runbook).toContain('Reativação controlada do SSX');
    expect(runbook).toContain('positions_last');
    expect(runbook).toContain('Observe staging por 24 horas');
    expect(runbook).toContain('ssx_kill_switch=true');
  });
});
