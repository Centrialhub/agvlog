import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('counts expiring documents only for operational employees',()=>{
  const migration=readFileSync('supabase/migrations/20260922005000_operations_dashboard_summary.sql','utf8');
  expect(migration).toContain("status in('active','on_leave')");
});
