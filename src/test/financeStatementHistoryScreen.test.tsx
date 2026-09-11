import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import FinanceStatements from '@/pages/FinanceStatements';
const mocks=vi.hoisted(()=>({list:vi.fn(),lines:vi.fn(),role:'operator',access:true}));
const tenant='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000001';
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:tenant},currentRole:mocks.role})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:actor}})}));
vi.mock('@/hooks/useFinanceLedger',()=>({useFinanceAccess:()=>({data:mocks.access,isPending:false,error:null})}));
vi.mock('@/lib/financial/ledgerClient',async original=>({...await original<object>(),readFinanceStatements:mocks.list,readFinanceStatementLines:mocks.lines}));
vi.mock('@/components/financial/StatementImportDialog',()=>({StatementImportDialog:()=>null}));
const statement={id:crypto.randomUUID(),tenant_id:tenant,bank_account_id:crypto.randomUUID(),account_name:'Conta principal',file_name:'Janeiro.csv',file_hash:'a'.repeat(64),source_path:'',
  period_start:'2026-01-01',period_end:'2026-01-31',input_rows:2,created_at:'2026-02-01T12:00:00Z',source_verification:'rows_match',verification_report:{},counts:{new:1,ambiguous:1},identity_review_count:1};
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><FinanceStatements/></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();mocks.role='operator';mocks.access=true;
  mocks.list.mockResolvedValue({version:1,tenant_id:tenant,page:1,page_size:20,total:21,rows:[statement]});
  mocks.lines.mockResolvedValue({version:1,tenant_id:tenant,import_id:statement.id,page:1,page_size:30,total:2,row_amount_total_cents:'-100000',rows:[],
    history:[{id:crypto.randomUUID(),actor_id:actor,actor_name:'Maria Financeiro',action:'source_checked',reason:'Conferência solicitada',created_at:'2026-02-01T12:00:00Z'}]});
});
describe('statement history preserves distinction between source checks and bank confirmation',()=>{
  it('shows original checks, pending identities, full-filter total and requesting actor',async()=>{
    mount();await screen.findByText('Janeiro.csv');expect(screen.getByText('21 arquivo(s) no filtro')).toBeInTheDocument();
    expect(screen.getByText('1 a revisar')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Detalhar Janeiro.csv'}));
    expect(await screen.findByText(/Soma das linhas:.*1.000,00.*não é saldo bancário/)).toBeInTheDocument();
    expect(screen.getByText(/Maria Financeiro · Solicitou conferência/)).toBeInTheDocument();
    expect(screen.getByText(/conferir as linhas não certifica o saldo de todo o período/)).toBeInTheDocument();
  });
  it('applies server filters only on submission and paginates the full result',async()=>{
    mount();await screen.findByText('Janeiro.csv');fireEvent.change(screen.getByLabelText('Buscar'),{target:{value:'100%'}});
    expect(mocks.list).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'Filtrar'}));
    await waitFor(()=>expect(mocks.list).toHaveBeenLastCalledWith(tenant,expect.objectContaining({search:'100%',page:1})));
    fireEvent.click(await screen.findByRole('button',{name:'Próxima'}));
    await waitFor(()=>expect(mocks.list).toHaveBeenLastCalledWith(tenant,expect.objectContaining({search:'100%',page:2})));
  });
  it('does not request financial data for drivers or server-denied internal users',()=>{
    mocks.role='driver';const first=mount();expect(mocks.list).not.toHaveBeenCalled();first.unmount();
    mocks.role='admin';mocks.access=false;mount();expect(mocks.list).not.toHaveBeenCalled();expect(mocks.lines).not.toHaveBeenCalled();
  });
});
