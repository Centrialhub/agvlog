import {renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
import {useBankAccounts} from '@/hooks/useFinancialPayments';
import {invalidateAccountDirectory} from '@/lib/financial/invalidateAccountReview';
const mock=vi.hoisted(()=>({read:vi.fn(),actor:'operator'}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:mock.actor?{id:mock.actor}:null})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>({select:()=>({eq:()=>({eq:()=>({order:mock.read})})})})}}));
beforeEach(()=>{vi.clearAllMocks();mock.actor='operator';mock.read.mockResolvedValue({data:[{id:'active',name:'Conta ativa',active:true}],error:null});});
function setup(){const client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity,retry:false}}});return {client,wrapper:({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>};}
it('does not reuse the full registry cache for active payment accounts',async()=>{
 const {client,wrapper}=setup();const registry=[{id:'inactive',active:false,account_type:'cash'}];client.setQueryData(['bank_accounts','tenant'],registry);
 const {result}=renderHook(()=>useBankAccounts(),{wrapper});await waitFor(()=>expect(result.current.isSuccess).toBe(true));
 expect(result.current.data).toEqual([{id:'active',name:'Conta ativa',active:true}]);expect(client.getQueryData(['bank_accounts','tenant'])).toEqual(registry);
 await invalidateAccountDirectory(client,'tenant');await waitFor(()=>expect(mock.read).toHaveBeenCalledTimes(2));
});
it('does not expose another user account options while the current user is loading',async()=>{
 const {client,wrapper}=setup();client.setQueryData(['finance-active-accounts','tenant','previous-user'],[{id:'private-cache'}]);
 let complete!:(value:unknown)=>void;mock.read.mockReturnValue(new Promise(resolve=>{complete=resolve;}));
 const {result}=renderHook(()=>useBankAccounts(),{wrapper});expect(result.current.data).toBeUndefined();
 complete({data:[],error:null});await waitFor(()=>expect(result.current.isSuccess).toBe(true));expect(result.current.data).toEqual([]);
});
it('does not fetch active accounts without a signed-in user',()=>{
 mock.actor='';const {wrapper}=setup();renderHook(()=>useBankAccounts(),{wrapper});expect(mock.read).not.toHaveBeenCalled();
});
