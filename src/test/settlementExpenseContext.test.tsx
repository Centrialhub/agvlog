import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {SettlementExpenseContextPanel} from '@/components/financial/SettlementExpenseContext';
const mock=vi.hoisted(()=>({read:vi.fn()}));vi.mock('@/lib/financial/settlementExpenseContextClient',()=>({readSettlementExpenseContext:mock.read}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),settlement=crypto.randomUUID(),payable=crypto.randomUUID();
const data={version:1,tenant_id:tenant,settlement_id:settlement,trip_id:crypto.randomUUID(),page:1,page_size:30,total:31,total_cents:'100000',allocated_cents:'40000',payable_cents:'60000',paid_cents:'10000',outstanding_cents:'50000',needs_review_count:1,rows:[{id:crypto.randomUUID(),batch_id:crypto.randomUUID(),category:'food',description:'Almoço da viagem',occurred_on:'2026-01-01',amount_cents:'30000',allocated_cents:'10000',payable_id:payable,payee_type:'driver',payee_name:'Motorista Paulo',payable_cents:'20000',paid_cents:'10000',outstanding_cents:'10000',payable_status:'approved',needs_review:true}]};
beforeEach(()=>{vi.clearAllMocks();mock.read.mockResolvedValue(data);});afterEach(cleanup);
function open(cache=new QueryClient({defaultOptions:{queries:{retry:false}}})){return render(<MemoryRouter><QueryClientProvider client={cache}><SettlementExpenseContextPanel tenant={tenant} actor={actor} settlement={settlement}/></QueryClientProvider></MemoryRouter>);}
it('shows server totals, payable beneficiary and explicit review without creating another reimbursement',async()=>{
 open();expect(await screen.findByText('R$ 1.000,00')).toBeInTheDocument();expect(screen.getByText('Motorista: Motorista Paulo')).toBeInTheDocument();expect(screen.getByText(/Título:/)).toHaveTextContent(payable);expect(screen.getByText(/não cria outro crédito/)).toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('1 gasto(s)');expect(screen.getByRole('link',{name:'Consultar contas a pagar'})).toHaveAttribute('href','/payables');
 fireEvent.click(screen.getByRole('button',{name:'Próxima'}));await waitFor(()=>expect(mock.read).toHaveBeenLastCalledWith(tenant,settlement,2));
});
it('does not infer a trip from a manual settlements loads',async()=>{mock.read.mockResolvedValue({...data,trip_id:null,total:0,rows:[]});open();expect(await screen.findByText(/não tem vínculo de viagem/)).toBeInTheDocument();expect(screen.queryByText('R$ 1.000,00')).not.toBeInTheDocument();expect(screen.queryByRole('link')).not.toBeInTheDocument();});
it('hides old financial context if the refreshed query fails',async()=>{
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});open(cache);await screen.findByText('Motorista: Motorista Paulo');mock.read.mockRejectedValue(new Error('finance_access_denied'));await act(async()=>{await cache.invalidateQueries({queryKey:['finance-settlement-expense-context']});});await waitFor(()=>expect(screen.queryByText('Motorista: Motorista Paulo')).not.toBeInTheDocument());expect(screen.getByRole('alert')).toHaveTextContent('Acesso financeiro não permitido');
});
