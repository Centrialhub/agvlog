import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {useOperationalDriverExpenseContext,useOperationalDriverExpenseSources} from '@/hooks/useDriverExpensesOperational';
const state=vi.hoisted(()=>({error:null as unknown,data:null as unknown,readSources:vi.fn(),readContext:vi.fn(),saveSources:vi.fn(),saveContext:vi.fn()}));
const tenant='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000001',source='30000000-0000-4000-8000-000000000001',driver='40000000-0000-4000-8000-000000000001';
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:actor}})}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:tenant}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:()=>({abortSignal:async()=>({data:state.data,error:state.error})})}}));
vi.mock('@/lib/driver/driverExpenseSubmission',()=>({DRIVER_EXPENSE_QUEUE_CHANGED:'synthetic',createDriverExpenseSubmission:()=>({}),driverExpenseOfflineStore:state}));
const row={id:source,driver_id:driver,status:'planned' as const,notes:null,created_at:'2026-10-05T12:00:00Z',actual_start_at:null,actual_end_at:null};
const context={version:1,tenant_id:tenant,actor_id:actor,source_type:'trip',source_id:source,driver_id:driver,driver_name:'QA',trip_id:source,settlement_id:null,manual_settlement_id:null,can_create:true,source_state:'planned',revision:'a'.repeat(32)};
let client:QueryClient;
beforeEach(()=>{vi.clearAllMocks();client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});state.data=null;state.error=null;state.readSources.mockResolvedValue([row]);state.readContext.mockResolvedValue(context);state.saveSources.mockResolvedValue(undefined);state.saveContext.mockResolvedValue(undefined);vi.spyOn(navigator,'onLine','get').mockReturnValue(true);});
afterEach(()=>{cleanup();client.clear();vi.restoreAllMocks();});
const wrapper=({children}:{children:React.ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
describe('operational expense cache respects session and server denials',()=>{
 it.each(['sources','context'])('does not turn an online authorization denial into cached %s',async kind=>{
  state.error={code:'42501',message:'not_authorized'};const {result}=renderHook(()=>kind==='sources'?useOperationalDriverExpenseSources(0):useOperationalDriverExpenseContext(source),{wrapper});
  await waitFor(()=>expect(result.current.isError).toBe(true));expect(result.current.data).toBeUndefined();expect(state.readSources).not.toHaveBeenCalled();expect(state.readContext).not.toHaveBeenCalled();
 });
 it.each([new TypeError('Failed to fetch'),{code:'',message:'TypeError: Failed to fetch'}])('uses the offline cache for a transport failure %j',async error=>{
  vi.spyOn(navigator,'onLine','get').mockReturnValue(false);state.error=error;const {result}=renderHook(()=>useOperationalDriverExpenseSources(0),{wrapper});
  await waitFor(()=>expect(result.current.isSuccess).toBe(true));expect(result.current.data).toMatchObject({offline:true,rows:[row]});expect(state.readSources).toHaveBeenCalledWith(tenant,actor);
 });
 it('does not hide a database denial even when the browser is offline',async()=>{
  vi.spyOn(navigator,'onLine','get').mockReturnValue(false);state.error={code:'42501',message:'permission denied'};const {result}=renderHook(()=>useOperationalDriverExpenseContext(source),{wrapper});
  await waitFor(()=>expect(result.current.isError).toBe(true));expect(state.readContext).not.toHaveBeenCalled();
 });
 it('does not hide a mismatched context behind the offline cache',async()=>{
  vi.spyOn(navigator,'onLine','get').mockReturnValue(false);state.data={...context,actor_id:driver};const {result}=renderHook(()=>useOperationalDriverExpenseContext(source),{wrapper});
  await waitFor(()=>expect(result.current.isError).toBe(true));expect(state.readContext).not.toHaveBeenCalled();
 });
});
