import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import CostCenters from '@/pages/CostCenters';
const mocks=vi.hoisted(()=>({read:vi.fn(),legacy:vi.fn(),access:true}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'},currentRole:'operator'})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/hooks/useFinanceLedger',()=>({useFinanceAccess:()=>({data:mocks.access,isPending:false,error:null})}));
vi.mock('@/lib/financial/ledgerClient',()=>({readRecordedCosts:mocks.read}));
vi.mock('@/pages/LegacyCostCenters',()=>({default:()=>{mocks.legacy();return <p>Fontes antigas</p>;}}));
vi.mock('@/components/cost-centers/CostCenterManager',()=>({CostCenterManager:()=>null}));
const data={page:1,page_size:30,total:33,total_cents:'23100',cancelled_count:1,needs_review_count:1,recorded_date_count:1,cost_centers:[{cost_center_id:null,cost_center_name:null,amount_cents:'23100'}],categories:[],rows:[]};
beforeEach(()=>{vi.clearAllMocks();mocks.access=true;mocks.read.mockResolvedValue(data);});afterEach(cleanup);
const mount=()=>render(<QueryClientProvider client={new QueryClient()}><CostCenters/></QueryClientProvider>);
it('shows complete server totals, disputed values and date basis without loading overlapping sources',async()=>{
 mount();expect(await screen.findByText('R$ 231,00')).toBeInTheDocument();expect(mocks.legacy).not.toHaveBeenCalled();
 expect(screen.getByText(/valor alterado no título/)).toBeInTheDocument();expect(screen.getByText(/sem competência informada/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/Sem centro de custo:/}));
 await waitFor(()=>expect(mocks.read).toHaveBeenLastCalledWith('tenant',expect.objectContaining({cost_center:'unassigned',page:1})));
 fireEvent.click(await screen.findByRole('button',{name:'Próxima'}));
 await waitFor(()=>expect(mocks.read).toHaveBeenLastCalledWith('tenant',expect.objectContaining({cost_center:'unassigned',page:2})));
});
it('does not expose either dataset when server access is denied',()=>{
 mocks.access=false;mount();expect(mocks.read).not.toHaveBeenCalled();expect(mocks.legacy).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('Acesso financeiro não permitido');
});
it('keeps unclassified payroll credits outside the displayed cost and exposes the pending amount',async()=>{
 mocks.read.mockResolvedValue({...data,total_cents:'305000',payroll_unclassified_count:2,payroll_unclassified_cents:'70000'});
 mount();expect(await screen.findByText('R$ 3.050,00')).toBeInTheDocument();
 expect(screen.getByText(/2 crédito\(s\) da folha, somando R\$ 700,00/)).toHaveTextContent('não entram neste total');
});
