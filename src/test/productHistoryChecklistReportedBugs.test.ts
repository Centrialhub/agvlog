import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260917151900_use_current_product_history_and_require_check.sql', 'utf8');

describe('reported product history and checklist bugs', () => {
  it('uses only current delivery-attempt allocations for items and stops', () => {
    expect(migration).toContain("replace(body,'from public.load_items item','from public.current_load_items item')");
    expect(migration).toContain("replace(body,'from public.dispatch_stop_documents link','from public.current_dispatch_stop_documents link')");
    expect(migration).toContain('read_product_history_v1(uuid,text,date,date) security definer');
  });

  it('does not classify an all-NA checklist as passed', () => {
    expect(migration).toContain('v_passed = 0 and v_failed = 0');
    expect(migration).toContain('checklist_requires_confirmed_verification');
    expect(migration.indexOf('checklist_requires_confirmed_verification')).toBeLessThan(migration.lastIndexOf("v_status := case when v_failed = 0 then 'passed'"));
  });
});
