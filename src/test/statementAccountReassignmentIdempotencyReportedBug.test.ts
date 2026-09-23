import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('statement account reassignment idempotency regression',()=>{
 it('persists request results, rejects payload reuse and blocks unchanged accounts',()=>{
  const migration=readFileSync('supabase/migrations/20260922035000_idempotent_statement_account_reassignment.sql','utf8');
  const client=readFileSync('src/lib/financial/ledgerClient.ts','utf8');
  const screen=readFileSync('src/components/financial/StatementHistoryDetail.tsx','utf8');
  expect(migration).toContain("cached.operation is distinct from 'statement_account_reassign'");
  expect(migration).toContain("raise exception 'statement_account_unchanged'");
  expect(migration).toContain('cached.response_body');
  expect(client).toContain('_request_id:requestId');
  expect(screen).toContain('reassignRequest.current?.fingerprint!==fingerprint');
 });
});
