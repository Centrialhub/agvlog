import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import FinanceExpenses from '@/pages/FinanceExpenses';
const mocks=vi.hoisted(()=>({history:vi.fn(),role:'operator',access:true}));
const tenant='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000001';
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:tenant},currentRole:mocks.role})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:actor}})}));
vi.mock('@/hooks/useFinanceLedger',()=>({useFinanceAccess:()=>({data:mocks.access,isPending:false,error:null})}));
vi.mock('@/lib/financial/ledgerClient',async original=>({...await original<object>(),readExpenseHistory:mocks.history}));
const row={id:crypto.randomUUID(),tenant_id:tenant,batch_id:crypto.randomUUID(),category:'food',description:'Almoço da viagem',amount_cents:5000,occurred_on:'2026-01-01',
  supplier_name:'Restaurante QA',document_number:'123',receipt_path:null,no_receipt_reason:'Recibo solicitado ao restaurante',context:'trip',trip_id:crypto.randomUUID(),driver_id:crypto.randomUUID(),
  batch_description:'Retorno da viagem',cost_center_name:'Operação',allocated_cents:5000,payable_id:null,payable_status:null,unloading_id:null,receivable_id:null,
  reimbursement_supplier_id:null,reimbursement_supplier_name:null,receivable_status:null,created_by:actor,created_at:'2026-01-02T12:00:00Z',
  allocations:[{movement_id:crypto.randomUUID(),amount_cents:5000,movement_amount_cents:50000,beneficiary_name:'Motorista QA',occurred_on:'2026-01-01',bank_reference:'PIX-QA'}],
  history:[{id:crypto.randomUUID(),actor_id:actor,actor_name:'Maria Financeiro',action:'recorded',reason:'Recibos conferidos no retorno',created_at:'2026-01-02T12:00:00Z'}]};
const result={version:1,tenant_id:tenant,page:1,page_size:30,total:31,total_cents:'155000',allocated_cents:'155000',complement_cents:'0',missing_receipt_count:31,
  cost_centers:[{cost_center_id:null,cost_center_name:null,amount_cents:'155000',item_count:31}],
  categories:[{category:'food',amount_cents:'155000',item_count:31}],rows:[row]};
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><FinanceExpenses/></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();mocks.role='operator';mocks.access=true;mocks.history.mockResolvedValue(result);});
describe('recorded expense history screen',()=>{
  it('filters by the server cost center totals and allows returning to all centers',async()=>{
    mount();fireEvent.click(await screen.findByRole('button',{name:/Sem centro de custo:.*1.550,00/}));
    await waitFor(()=>expect(mocks.history).toHaveBeenLastCalledWith(tenant,expect.objectContaining({cost_center:'unassigned',page:1})));
    expect(await screen.findByText(/Envios e títulos de complemento não são somados novamente/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Todos os centros'}));
    await waitFor(()=>expect(mocks.history).toHaveBeenLastCalledWith(tenant,expect.objectContaining({cost_center:'',page:1})));
  });
  it('shows server totals and details explaining the shared send and recording actor',async()=>{
    mount();await screen.findByText('Almoço da viagem');
    expect(screen.getAllByText('R$ 1.550,00').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button',{name:'Detalhar Almoço da viagem'}));
    expect(await screen.findByText('Maria Financeiro · Registrou o lote')).toBeInTheDocument();
    expect(screen.getByText(/Envio de R\$ 500,00 · Este gasto utiliza R\$ 50,00/)).toBeInTheDocument();
    expect(screen.getByText(/Recibo solicitado ao restaurante/)).toBeInTheDocument();
  });
  it('applies filters deliberately instead of using a partial local total',async()=>{
    mount();await screen.findByText('Almoço da viagem');
    fireEvent.change(screen.getByLabelText('Buscar'),{target:{value:'almoço'}});
    expect(mocks.history).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'Filtrar'}));
    await waitFor(()=>expect(mocks.history).toHaveBeenLastCalledWith(tenant,expect.objectContaining({search:'almoço',page:1})));
  });
  it('never fetches expense history for a driver or a user denied by the server',()=>{
    mocks.role='driver';const first=mount();expect(mocks.history).not.toHaveBeenCalled();first.unmount();
    mocks.role='admin';mocks.access=false;mount();expect(mocks.history).not.toHaveBeenCalled();
  });
});
