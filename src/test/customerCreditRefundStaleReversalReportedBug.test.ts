import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('stale customer credit refund reversal regression',()=>{
 it('clears a definitive stale replay and exposes manual discard for uncertain transport failures',()=>{
  const client=readFileSync('src/lib/financial/customerCreditRefundClient.ts','utf8');
  const panel=readFileSync('src/components/financial/CustomerCreditRefundPanel.tsx','utf8');
  expect(client).toContain('if(definitive&&localStorage.getItem(key)===marked)localStorage.removeItem(key)');
  expect(client).not.toContain('definitive&&!wasUncertain');
  expect(panel).toContain('Descartar pedido de reversão preservado');
  expect(panel).toContain('discardCustomerCreditRefundReversal');
 });
});
