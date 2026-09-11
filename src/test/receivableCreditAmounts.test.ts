import {expect,it} from 'vitest';
import {legacyReceivableCents,creditCompositionValid} from '@/lib/financial/receivableCreditAmounts';
it('converts exact legacy decimals without binary multiplication or rounding',()=>{
 expect(legacyReceivableCents(0.29)).toBe('29');expect(legacyReceivableCents(999999999999.99)).toBe('99999999999999');expect(legacyReceivableCents(0)).toBe('0');
 for(const v of [1.005,NaN,Infinity,-Infinity,-1,1000000000000,Number.MAX_VALUE,null])expect(legacyReceivableCents(v)).toBeNull();
});
it('bounds textual cents and rejects malformed legacy comparisons without throwing',()=>{
 for(const value of ['100000000000000','1.5','NaN'])expect(creditCompositionValid({cash_received_cents:value,credit_applied_cents:'0',settled_cents:value})).toBe(false);
 expect(creditCompositionValid({cash_received_cents:0,credit_applied_cents:0,settled_cents:0},NaN)).toBe(false);
});
