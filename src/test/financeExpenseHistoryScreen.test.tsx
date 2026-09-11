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
function mount(client=new QueryClient({defaultOptions:{queries:{retry:false}}})){return render(<QueryClientProvider client={client}><FinanceExpenses/></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();mocks.role='operator';mocks.access=true;mocks.history.mockResolvedValue(result);});
describe('recorded expense history screen',()=>{
  it('preserves an open correction review while refreshing the surrounding expense list',async()=>{
    mocks.role='admin';mocks.history.mockResolvedValueOnce({...result,rows:[{...row,unloading_id:crypto.randomUUID()}]}).mockImplementation(()=>new Promise(()=>{}));
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});mount(client);
    fireEvent.click(await screen.findByRole('button',{name:'Detalhar Almoço da viagem'}));
    fireEvent.click(screen.getByRole('button',{name:'Conferir correção do custo da descarga'}));
    expect(screen.getByRole('dialog',{name:'Corrigir custo e obrigação da descarga'})).toBeInTheDocument();
    void client.invalidateQueries({queryKey:['finance-expenses',tenant,actor]});
    await waitFor(()=>expect(screen.getByText(/Atualizando o detalhe/)).toBeInTheDocument());
    expect(screen.getByRole('dialog',{name:'Corrigir custo e obrigação da descarga'})).toBeInTheDocument();
    expect(screen.queryByText('Custo vigente registrado: R$ 50,00')).not.toBeInTheDocument();
  });

  it('offers cost correction from an unloading expense only for an administrator',async()=>{
    mocks.history.mockResolvedValue({...result,rows:[{...row,unloading_id:crypto.randomUUID()}]});
    const operator=mount();fireEvent.click(await screen.findByRole('button',{name:'Detalhar Almoço da viagem'}));
    expect(screen.queryByRole('button',{name:'Conferir correção do custo da descarga'})).not.toBeInTheDocument();operator.unmount();
    mocks.role='admin';mount();fireEvent.click(await screen.findByRole('button',{name:'Detalhar Almoço da viagem'}));
    expect(await screen.findByRole('button',{name:'Conferir correção do custo da descarga'})).toBeInTheDocument();
  });

  it('uses the verified corrected cost in the list and payable detail while preserving its original',async()=>{
    const expense={...row,amount_cents:15000,allocated_cents:0,payable_id:crypto.randomUUID(),payable_status:'pending',unloading_id:crypto.randomUUID(),allocations:[],cancelled:false};
    const origin={version:1,tenant_id:tenant,expense_id:expense.id,charge_id:expense.unloading_id,payable_id:expense.payable_id,verified:true,issue:null,original_amount_cents:'15000',effective_amount_cents:'12000',revision:'a'.repeat(32),history:[{id:crypto.randomUUID(),ordinal:1,previous_id:null,request_id:crypto.randomUUID(),before_amount_cents:'15000',after_amount_cents:'12000',approval_reset:true,actor_id:actor,actor_name:'Maria Financeiro',reason:'Recibo corrigido após conferência',created_at:'2026-09-11T06:00:00Z',revision_after:'a'.repeat(32)}]};
    mocks.history.mockResolvedValue({...result,total_cents:'12000',complement_cents:'12000',rows:[{...expense,cost_origin:origin,effective_amount_cents:'12000'}]});
    mount();await screen.findByText(/Retificado · original R\$ 150,00/);
    fireEvent.click(screen.getByRole('button',{name:'Detalhar Almoço da viagem'}));
    expect(await screen.findByText('Custo vigente registrado: R$ 120,00')).toBeInTheDocument();
    expect(screen.getByText('R$ 120,00 · Pendente')).toBeInTheDocument();
    expect(screen.getByText('De R$ 150,00 para R$ 120,00')).toBeInTheDocument();
    expect(screen.getByText(/A aprovação anterior foi retirada/)).toBeInTheDocument();
    expect(screen.getByText('Motivo: Recibo corrigido após conferência')).toBeInTheDocument();
  });
  it('shows unavailable current cost and totals instead of using the original when evidence is missing',async()=>{
    mocks.history.mockResolvedValue({...result,total_cents:null,complement_cents:null,cost_needs_review_count:1,categories:[{category:'food',amount_cents:null,item_count:1}],cost_centers:[],rows:[{...row,cost_origin:null,effective_amount_cents:null}]});
    mount();expect(await screen.findByText(/1 gasto\(s\) com origem de custo pendente/)).toBeInTheDocument();
    expect(screen.getAllByText('A conferir').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('button',{name:'Detalhar Almoço da viagem'}));
    expect(await screen.findByText('Custo vigente registrado: A conferir')).toBeInTheDocument();
    expect(screen.getByText(/O valor original não substitui/)).toBeInTheDocument();
  });

  it('identifies a later attachment without claiming the original receipt existed',async()=>{
    mocks.history.mockResolvedValue({...result,rows:[{...row,receipt_artifact_count:1}]});
    mount();expect(await screen.findByText('Anexado posteriormente')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Detalhar Almoço da viagem'}));
    expect(await screen.findByText(/Sem comprovante no registro original/)).toBeInTheDocument();
  });
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
    expect(screen.getByText(/Envio de R\$ 500,00 · Vínculo original deste gasto: R\$ 50,00/)).toBeInTheDocument();
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

it('opens funded cost regularization only for an admin unloading expense',async()=>{mocks.role='admin';const regular=mount();fireEvent.click(await screen.findByRole('button',{name:'Detalhar Almoço da viagem'}));expect(screen.queryByRole('button',{name:'Conferir regularização de custo coberto'})).not.toBeInTheDocument();regular.unmount();mocks.history.mockResolvedValue({...result,rows:[{...row,unloading_id:crypto.randomUUID()}]});mount();fireEvent.click(await screen.findByRole('button',{name:'Detalhar Almoço da viagem'}));fireEvent.click(screen.getByRole('button',{name:'Conferir regularização de custo coberto'}));expect(screen.getByRole('dialog',{name:'Regularizar custo coberto e saldo pendente'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Confirmar regularização de custo'})).not.toBeInTheDocument();});
