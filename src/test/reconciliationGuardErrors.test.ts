import {it,expect,vi} from 'vitest';
import {FinanceRejectedError,readReconciliationContext} from '@/lib/financial/ledgerClient';
import {reconciliationError} from '@/lib/financial/reconciliationContract';
const mock=vi.hoisted(()=>vi.fn());vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock}}));
it.each([['finance_reconciliation_movement_inactive','23514','invalidado'],['finance_dependency_busy','40001','Outra operação']])('classifies and explains %s as confirmed rollback',async(message,code,text)=>{mock.mockResolvedValueOnce({data:null,error:{message,code}});await expect(readReconciliationContext(crypto.randomUUID(),[],[])).rejects.toBeInstanceOf(FinanceRejectedError);expect(reconciliationError(new Error(message))).toContain(text);});
