import {it,expect,vi} from 'vitest';
import {readSettlementExpenseContext} from '@/lib/financial/settlementExpenseContextClient';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
const tenant=crypto.randomUUID(),settlement=crypto.randomUUID();
const data={version:1,tenant_id:tenant,settlement_id:settlement,trip_id:null,page:1,page_size:30,total:0,total_cents:'0',allocated_cents:'0',payable_cents:'0',paid_cents:'0',outstanding_cents:'0',needs_review_count:0,rows:[]};
it('validates settlement, tenant, pagination and string money fields',async()=>{
 mock.rpc.mockResolvedValueOnce({data,error:null});await expect(readSettlementExpenseContext(tenant,settlement,1)).resolves.toMatchObject({trip_id:null});expect(mock.rpc).toHaveBeenLastCalledWith('get_finance_settlement_expense_context',{_tenant_id:tenant,_settlement_id:settlement,_page:1});
 for(const altered of [{...data,settlement_id:crypto.randomUUID()},{...data,tenant_id:crypto.randomUUID()},{...data,page:2},{...data,total_cents:100}]){mock.rpc.mockResolvedValueOnce({data:altered,error:null});await expect(readSettlementExpenseContext(tenant,settlement,1)).rejects.toThrow();}
});
