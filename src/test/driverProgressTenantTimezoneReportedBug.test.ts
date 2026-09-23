import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('driver progress tenant timezone regression',()=>{
 it('restores the tenant timezone in date validation and local-time conversion',()=>{
  const migration=readFileSync('supabase/migrations/20260922037000_restore_driver_progress_tenant_timezone.sql','utf8');
  expect(migration).toContain('v_timezone:=private.driver_monitor_tenant_timezone(v_tenant)');
  expect(migration).toContain('(clock_timestamp() at time zone v_timezone)::date');
  expect(migration).toContain('(v_monitor_row.started_at at time zone v_timezone)::date');
  expect(migration).toContain('at time zone v_timezone$new$');
  expect(migration).toContain("position('America/Sao_Paulo' in changed)>0");
 });
});
