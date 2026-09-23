import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const migration=readFileSync('supabase/migrations/20260922202000_guard_legacy_payable_beneficiary.sql','utf8');

describe('Bug 1714 - legacy payable beneficiary identity',()=>{
 it('filters candidates, guards inserts and requires the explicit declaration',()=>{
  expect(migration).toContain('finance_legacy_payable_beneficiary_mismatch');
  expect(migration).toContain("existing_payment_confirmed' is distinct from 'true'::jsonb");
  expect(migration).toContain("lower(regexp_replace(btrim(payable.supplier_name)");
  expect(migration).toContain('create trigger finance_check_legacy_payable_beneficiary');
 });
});
