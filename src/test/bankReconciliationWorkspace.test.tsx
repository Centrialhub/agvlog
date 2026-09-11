import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import BankReconciliation from '@/pages/BankReconciliation';
const mocks=vi.hoisted(()=>({role:'operator',access:true,transactions:vi.fn(),obligations:vi.fn(),suggestions:vi.fn()}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'},currentRole:mocks.role})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/hooks/useFinanceLedger',()=>({useFinanceAccess:()=>({data:mocks.access,isPending:false,error:null})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:vi.fn()})}));
vi.mock('@/pages/FinanceStatements',()=>({default:()=> <p>Área de extratos preservados</p>}));
vi.mock('@/components/financial/ReconciliationMovementEntry',()=>({ReconciliationMovementEntry:()=>null}));
vi.mock('@/components/financial/ReconciliationStatementImport',()=>({ReconciliationStatementImport:()=>null}));
vi.mock('@/hooks/useBankReconciliation',()=>({useBankAccounts:()=>({data:[{id:'account',name:'Principal'}]}),useCreateBankAccount:()=>({mutate:vi.fn()}),useBankTransactions:mocks.transactions,useFinancialObligations:mocks.obligations,useSuggestedMatches:mocks.suggestions}));
beforeEach(()=>{
 vi.clearAllMocks();mocks.role='operator';mocks.access=true;
 mocks.transactions.mockReturnValue({data:[{id:'debit',posted_at:'2026-09-01T12:00:00Z',description:'Débito registrado positivo',amount:500,transaction_type:'debit',reconciliation_status:'matched'}]});
 mocks.obligations.mockReturnValue({data:[]});mocks.suggestions.mockReturnValue({data:[]});
});
afterEach(cleanup);
const mount=()=>render(<MemoryRouter><BankReconciliation/></MemoryRouter>);
it('opens the preserved statements workspace and loads legacy records only on request',()=>{
 mount();expect(screen.getByText('Área de extratos preservados')).toBeInTheDocument();expect(mocks.transactions).not.toHaveBeenCalled();
 fireEvent.mouseDown(screen.getByRole('tab',{name:'Histórico anterior'}),{button:0,ctrlKey:false});
 expect(mocks.transactions).toHaveBeenCalled();
 expect(screen.getByText(/Os status antigos não certificam/)).toBeInTheDocument();
 expect(screen.getByText(/Consulta limitada a 1.000 transações/)).toBeInTheDocument();
 expect(screen.getByText('Saída · R$ 500,00')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Rodar conciliação'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Sincronizar títulos'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Conciliar'})).not.toBeInTheDocument();
});
it('denies drivers and internal users denied by the server before loading either workspace',()=>{
 mocks.role='driver';const view=mount();expect(screen.getByRole('alert')).toHaveTextContent('Acesso financeiro não permitido');view.unmount();
 mocks.role='admin';mocks.access=false;mount();expect(screen.queryByText('Área de extratos preservados')).not.toBeInTheDocument();expect(mocks.transactions).not.toHaveBeenCalled();
});
