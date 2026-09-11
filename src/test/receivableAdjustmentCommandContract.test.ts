import {expect,it} from 'vitest';
import {receivableAdjustmentCommandSchema} from '@/lib/financial/receivableAdjustmentCommandContract';
const command={version:1,tenant_id:crypto.randomUUID(),request_id:crypto.randomUUID(),receivable_id:crypto.randomUUID(),action:'apply',kind:'discount',adjustment_id:null,amount_cents:'10000',effective_on:'2026-09-11',expected_revision:'a'.repeat(32),reason:'Acordo comercial conferido'};
it('requires an original adjustment for reversal and preserves an exact noncash proposal',()=>{
 expect(receivableAdjustmentCommandSchema.parse(command)).toEqual(command);
 expect(receivableAdjustmentCommandSchema.safeParse({...command,kind:'loss'}).success).toBe(true);
 expect(receivableAdjustmentCommandSchema.safeParse({...command,action:'reverse',adjustment_id:crypto.randomUUID()}).success).toBe(true);
 for(const override of [{action:'reverse'},{adjustment_id:crypto.randomUUID()},{kind:'credit'},{amount_cents:'1.5'},{amount_cents:'0'},{bank_account_id:crypto.randomUUID()}])expect(receivableAdjustmentCommandSchema.safeParse({...command,...override}).success).toBe(false);
});
