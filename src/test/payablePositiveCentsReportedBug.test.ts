import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';import{payableXmlMoney}from'@/lib/financial/payableXmlContract';
const page=readFileSync('src/pages/Payables.tsx','utf8'),migration=readFileSync('supabase/migrations/20260922013000_require_positive_payable_amount.sql','utf8');
describe('positive whole-cent payable amounts',()=>{
 it('rejects sub-cent and zero form values before mutation',()=>{expect(()=>payableXmlMoney('0.001')).toThrow();expect(()=>payableXmlMoney('0')).toThrow();expect(payableXmlMoney('0.01')).toBe('1');expect(page).toContain('amount: Number(amountCents)/100');expect(page).toContain('min="0.01" step="0.01"');});
 it('rejects values rounded to zero at the numeric database boundary',()=>{expect(migration).toContain('check(amount>0) not valid');expect(migration).toContain('validate constraint payables_amount_positive');});
});
