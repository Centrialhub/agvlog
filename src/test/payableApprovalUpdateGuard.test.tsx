import {renderHook,act} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,it,expect,vi} from 'vitest';
import {useUpdatePayable} from '@/hooks/usePayables';
const m=vi.hoisted(()=>({from:vi.fn(),update:vi.fn(),eq:vi.fn(),select:vi.fn(),single:vi.fn(),tenant:'11111111-1111-4111-8111-111111111111'}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:m.from}}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:m.tenant}})}));
vi.mock('@/lib/financial/invalidateAccountReview',()=>({invalidateAccountReview:vi.fn().mockResolvedValue(undefined)}));
beforeEach(()=>{vi.clearAllMocks();m.from.mockReturnValue({update:m.update});m.update.mockReturnValue({eq:m.eq});m.eq.mockReturnValue({eq:m.eq,select:m.select});m.select.mockReturnValue({single:m.single});m.single.mockResolvedValue({data:{id:'id',tenant_id:m.tenant},error:null});});
function hook(){const cache=new QueryClient();return renderHook(()=>useUpdatePayable(),{wrapper:({children})=><QueryClientProvider client={cache}>{children}</QueryClientProvider>});}
it('rejects raw approval or approval metadata before any database call',async()=>{const {result}=hook();for(const patch of [{status:'approved'},{approved_at:'2026-09-11T00:00:00Z'},{approved_by:crypto.randomUUID()}])await act(async()=>{await expect(result.current.mutateAsync({id:'id',...patch})).rejects.toThrow('aprovação exige');});expect(m.from).not.toHaveBeenCalled();});
it('keeps other edits available with tenant scope without approval fields',async()=>{const {result}=hook();await act(async()=>{await result.current.mutateAsync({id:'id',notes:'Observação permitida'});});expect(m.update).toHaveBeenCalledWith(expect.objectContaining({notes:'Observação permitida'}));expect(m.update.mock.calls[0][0]).not.toHaveProperty('approved_at');expect(m.eq).toHaveBeenCalledWith('tenant_id',m.tenant);});
