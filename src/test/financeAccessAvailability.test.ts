import {beforeEach,expect,it,vi} from 'vitest';
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
import {FinanceUnavailableError,readFinanceAccess} from '@/lib/financial/ledgerClient';
const tenant='00000000-0000-4000-8000-000000000001';
beforeEach(()=>rpc.mockReset());
it.each(['PGRST202','42883'])('identifies an unavailable access endpoint (%s) without granting access',async code=>{
 rpc.mockResolvedValue({data:null,error:{code,message:'function unavailable'}});
 await expect(readFinanceAccess(tenant)).rejects.toBeInstanceOf(FinanceUnavailableError);
 expect(rpc).toHaveBeenCalledWith('get_finance_access',{_tenant_id:tenant});
});
it('keeps permission denial distinct from missing deployment',async()=>{
 rpc.mockResolvedValue({data:false,error:null});expect(await readFinanceAccess(tenant)).toBe(false);
 rpc.mockResolvedValue({data:null,error:{code:'42501',message:'denied'}});
 await expect(readFinanceAccess(tenant)).rejects.not.toBeInstanceOf(FinanceUnavailableError);
});
it('does not turn transport failures or malformed responses into permission',async()=>{
 rpc.mockResolvedValue({data:null,error:{message:'network unavailable'}});
 await expect(readFinanceAccess(tenant)).rejects.not.toBeInstanceOf(FinanceUnavailableError);
 for(const value of [null,{},'true',1]){rpc.mockResolvedValue({data:value,error:null});await expect(readFinanceAccess(tenant)).rejects.toThrow('Invalid finance access response');}
 rpc.mockResolvedValue({data:true,error:null});expect(await readFinanceAccess(tenant)).toBe(true);
});
