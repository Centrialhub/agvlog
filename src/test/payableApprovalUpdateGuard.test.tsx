import {renderHook,act} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,it,expect,vi} from 'vitest';
import {useUpdatePayable} from '@/hooks/usePayables';
const m=vi.hoisted(()=>({save:vi.fn(),from:vi.fn(),update:vi.fn(),eq:vi.fn(),select:vi.fn(),maybeSingle:vi.fn(),tenant:'11111111-1111-4111-8111-111111111111'}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:m.from}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/lib/financial/manualTitleCommand',()=>({saveManualTitle:m.save}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:m.tenant}})}));
vi.mock('@/lib/financial/invalidateAccountReview',()=>({invalidateAccountReview:vi.fn().mockResolvedValue(undefined)}));
beforeEach(()=>{vi.clearAllMocks();m.save.mockResolvedValue({id:'id',tenant_id:m.tenant});m.from.mockReturnValue({update:m.update});m.update.mockReturnValue({eq:m.eq});m.eq.mockReturnValue({eq:m.eq,select:m.select});m.select.mockReturnValue({maybeSingle:m.maybeSingle});m.maybeSingle.mockResolvedValue({data:{id:'id',tenant_id:m.tenant},error:null});});
function hook(){const cache=new QueryClient();return renderHook(()=>useUpdatePayable(),{wrapper:({children})=><QueryClientProvider client={cache}>{children}</QueryClientProvider>});}
it('rejects raw approval or approval metadata before any database call',async()=>{const {result}=hook();for(const patch of [{status:'approved'},{approved_at:'2026-09-11T00:00:00Z'},{approved_by:crypto.randomUUID()}])await act(async()=>{await expect(result.current.mutateAsync({id:'id',expected_updated_at:'2026-09-11T00:00:00Z',...patch})).rejects.toThrow('aprovação exige');});expect(m.from).not.toHaveBeenCalled();});
it('keeps other edits available with tenant scope and an atomic revision predicate',async()=>{const {result}=hook();await act(async()=>{await result.current.mutateAsync({id:'id',expected_updated_at:'2026-09-11T00:00:00Z',notes:'Observação permitida'});});expect(m.save).toHaveBeenCalledWith(m.tenant,'actor','payable',{notes:'Observação permitida'},'id','2026-09-11T00:00:00Z');});
it('reports a concurrent edit when the compare-and-swap matches no row',async()=>{m.save.mockRejectedValueOnce(new Error('Conta alterada por outra pessoa'));const {result}=hook();await act(async()=>{await expect(result.current.mutateAsync({id:'id',expected_updated_at:'2026-09-11T00:00:00Z',notes:'Nova'})).rejects.toThrow('alterada por outra pessoa');});});
