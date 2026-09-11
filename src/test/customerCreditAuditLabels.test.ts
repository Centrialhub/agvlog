import {expect,it} from 'vitest';
import {financeAuditActions} from '@/lib/financial/financeAuditContract';
it('distinguishes application, release and actual refund linkage in audit labels',()=>{
 expect(financeAuditActions.customer_credit_applied).toBe('Crédito do cliente aplicado ao título (sem novo dinheiro)');
 expect(financeAuditActions.customer_credit_application_released).toBe('Aplicação de crédito liberada (sem devolução de dinheiro)');
 expect(financeAuditActions.customer_credit_refunded).toBe('Devolução de crédito vinculada a saída já registrada');
});
