import {beforeEach,expect,it,vi} from 'vitest';
import {readLegacyInventory} from '@/lib/financial/legacyInventoryClient';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
const tenant=crypto.randomUUID(),account=crypto.randomUUID();
const section={page:1,page_size:30,total:0,counts_by_source:{},rows:[]};
const result={...section,version:1,tenant_id:tenant,account_id:account,from:'2026-01-01',to:'2026-01-31',unknown_account:{...section,scope:'tenant',not_additive_across_accounts:true},legacy_integration_status:'not_reviewed',can_close:false};
beforeEach(()=>vi.clearAllMocks());
it('uses the read-only inventory RPC with the exact account and dates',async()=>{
 mock.rpc.mockResolvedValue({data:result,error:null});expect(await readLegacyInventory(tenant,account,result.from,result.to,1)).toEqual(result);
 expect(mock.rpc).toHaveBeenCalledWith('get_finance_legacy_adoption_inventory',{_tenant_id:tenant,_account_id:account,_from:result.from,_to:result.to,_page:1});
});
it('rejects a different account, page or fabricated closing confirmation',async()=>{
 for(const data of [{...result,account_id:crypto.randomUUID()},{...result,unknown_account:{...result.unknown_account,page:2}},{...result,can_close:true}]){
  mock.rpc.mockResolvedValue({data,error:null});await expect(readLegacyInventory(tenant,account,result.from,result.to,1)).rejects.toThrow();
 }
});
