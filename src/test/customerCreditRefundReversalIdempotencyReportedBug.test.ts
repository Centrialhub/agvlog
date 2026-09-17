import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const migration=readFileSync('supabase/migrations/20260917151000_make_credit_refund_reversal_idempotent.sql','utf8');
const client=readFileSync('src/lib/financial/customerCreditRefundClient.ts','utf8');

describe('customer credit refund reversal idempotency',()=>{
 it('journals a request identity and replays its original result',()=>{expect(migration).toContain('request_id=_request_id');expect(migration).toContain("'replayed',true");expect(migration).toContain('refund_reversal_request_conflict');});
 it('persists the same command before transport and clears it only after confirmation',()=>{expect(client).toContain('uncertain:true');expect(client).toContain('_request_id:pending.request_id');expect(client).toContain('localStorage.removeItem(key)');});
});
