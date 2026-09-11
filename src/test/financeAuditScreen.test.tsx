import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import FinanceAudit from '@/pages/FinanceAudit';
const mocks=vi.hoisted(()=>({audit:vi.fn(),role:'operator',access:true}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),historicalActor=crypto.randomUUID();
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:tenant},currentRole:mocks.role})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:actor}})}));
vi.mock('@/hooks/useFinanceLedger',()=>({useFinanceAccess:()=>({data:mocks.access,isPending:false,error:null})}));
vi.mock('@/lib/financial/ledgerClient',async original=>({...await original<object>(),readFinanceAudit:mocks.audit}));
function mount(){return render(<QueryClientProvider client={new QueryClient()}><FinanceAudit/></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();mocks.role='operator';mocks.access=true;mocks.audit.mockResolvedValue({version:1,tenant_id:tenant,page:1,page_size:30,total:45,manual_count:45,timezone:'America/Sao_Paulo',rows:[{
  id:crypto.randomUUID(),tenant_id:tenant,entity_type:'statement_import',entity_id:crypto.randomUUID(),action:'identity_review_reversed',actor_id:historicalActor,actor_name:'Maria Financeiro',reason:'Correção após nova conferência',created_at:'2026-09-09T03:00:00Z',manual_intervention:true,decision:null,row_id:null,statement_name:'Setembro.csv',source_row:2,
}]});});
describe('finance audit workspace',()=>{
  it('keeps reversed interventions visible and filters the responsible person by stable identity',async()=>{
    mount();expect(await screen.findByText(/45 evento\(s\) no filtro/)).toBeInTheDocument();expect(screen.getAllByText('Decisão manual revertida').length).toBeGreaterThan(0);
    expect(screen.getByText('Intervenção manual — histórico permanente')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Filtrar esta pessoa'}));
    await waitFor(()=>expect(mocks.audit).toHaveBeenLastCalledWith(tenant,expect.objectContaining({actor_id:historicalActor,page:1})));
  });
  it('applies name filters on submit and denies driver access before querying',async()=>{
    const first=mount();await screen.findByText(/45 evento\(s\) no filtro/);fireEvent.change(screen.getByLabelText('Responsável'),{target:{value:'Maria'}});expect(mocks.audit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'Filtrar'}));await waitFor(()=>expect(mocks.audit).toHaveBeenLastCalledWith(tenant,expect.objectContaining({actor_search:'Maria'})));
    first.unmount();mocks.audit.mockClear();mocks.role='driver';mount();expect(mocks.audit).not.toHaveBeenCalled();
  });
});
