import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';
const page=readFileSync('src/pages/IntegrationHealth.tsx','utf8'),parser=readFileSync('src/lib/trackingObservability.ts','utf8'),migration=readFileSync('supabase/migrations/20260922010000_version_and_audit_tracking_schedule.sql','utf8');
describe('versioned SSX schedule settings',()=>{
 it('sends and compares a configuration-only revision',()=>{expect(page).toContain('expected_updated_at: schedule.configurationUpdatedAt');expect(parser).toContain("optionalTimestamp(schedule, 'configuration_updated_at')");expect(migration).toContain('tracking_schedule_revision_conflict');expect(migration).toContain('for update');});
 it('audits before and after every configuration change',()=>{expect(migration).toContain('audit_tracking_schedule_configuration_v1');expect(migration).toContain('to_jsonb(old),to_jsonb(new)');expect(migration).toContain("'configuration_update'");});
});
