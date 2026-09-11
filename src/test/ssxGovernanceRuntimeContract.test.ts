// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const governance = readFileSync('supabase/functions/ssx-sync-governance/index.ts', 'utf8');
const violations = readFileSync('supabase/functions/ssx-sync-rule-violations/index.ts', 'utf8');
const pipeline = readFileSync('supabase/functions/agvlog-pipeline-run/index.ts', 'utf8');
const settings = readFileSync('src/pages/Settings.tsx', 'utf8');

describe('SSX governance runtime contract', () => {
  it('uses the exact official Tracking routes and request shapes', () => {
    for (const path of [
      '/Tracking/EvaluationFormula/List',
      '/Tracking/Person/ListPersonRole',
      '/Tracking/Trailer/List',
      '/Tracking/RuleList/ListRuleOfLoggedUser',
      '/Tracking/RuleCompatible/List',
      '/Tracking/RuleList/ListRulesByUnitTracked',
      '/Tracking/RuleList/ListUnitTrackedByRule',
    ]) expect(governance).toContain(path);
    expect(governance).toContain('TrackingUnitIntegrationCode: unitCode');
    expect(governance).toContain('PropertyName: "TrackedUnitIntegrationCode", Condition: "="');
    expect(governance).toContain('body: { RuleIntegrationCode: ruleCode }');
    expect(governance).not.toContain('/v1/Tracking/');
  });

  it('bounds rule-violation windows, recursively handles the 500 result cap, and omits video URLs', () => {
    expect(violations).toContain('/Tracking/RuleViolation/v2/List');
    expect(violations).toContain('const RESULT_LIMIT = 500');
    expect(violations).toContain('const MAX_REQUESTS = 32');
    expect(violations).toContain('PropertyName: "IdPosition", Condition: ">="');
    expect(violations).toContain('PropertyName: "IdPosition", Condition: "<="');
    expect(violations).toContain('partial_window: requestBudgetExhausted');
    expect(violations).not.toMatch(/SAFE_PAYLOAD_FIELDS[\s\S]*?"Videos"/);
  });

  it('orders unit discovery before governance and positions before violations', () => {
    expect(pipeline.indexOf('"ssx-sync-units"')).toBeLessThan(
      pipeline.indexOf('"ssx-sync-governance"'),
    );
    expect(pipeline.indexOf('"ssx-poll-positions"')).toBeLessThan(
      pipeline.indexOf('"ssx-sync-rule-violations"'),
    );
    expect(settings).toContain("supabase.functions.invoke('ssx-sync-governance'");
  });
});
