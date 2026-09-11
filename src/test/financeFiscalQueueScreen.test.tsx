import {fiscalQueueIssue} from '@/lib/financial/fiscalQueueContract';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import FinanceFiscalQueue from '@/pages/FinanceFiscalQueue';
const mock=vi.hoisted(()=>({read:vi.fn(),role:'operator',access:true}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID();
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:tenant},currentRole:mock.role})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:actor}})}));
vi.mock('@/hooks/useFinanceLedger',()=>({useFinanceAccess:()=>({data:mock.access,isPending:false,error:null})}));
vi.mock('@/lib/financial/ledgerClient',()=>({readFiscalQueue:mock.read}));
function mount(){return render(<QueryClientProvider client={new QueryClient()}><FinanceFiscalQueue/></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();mock.role='operator';mock.access=true;mock.read.mockResolvedValue({version:1,tenant_id:tenant,page:1,page_size:30,status_filter:'review',total:31,
 scheduler_active:false,counts:{pending:5,review:31,applied:10,superseded:2},rows:[{observation_id:crypto.randomUUID(),tenant_id:tenant,status:'review',document_type:'cte',document_number:'4321',fiscal_status:'authorized',attempts:5,automatic_failures:5,issue:'automatic_projection_failed',available_at:'2026-09-09T15:00:00Z',created_at:'2026-09-09T12:00:00Z',updated_at:'2026-09-09T14:00:00Z',receivable_id:null}]});});
describe('fiscal receivables monitoring',()=>{
 it('shows processing failures without presenting them as receipts and resets pagination on filtering',async()=>{
  mount();await screen.findByText(/CT-e 4321/);
  expect(screen.getByText(/processamento automático não está ativo/)).toBeInTheDocument();
  expect(screen.getByText(/tentativas automáticas falharam/)).toBeInTheDocument();
  expect(screen.getByText(/Processado não significa recebido/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Próxima'}));await waitFor(()=>expect(mock.read).toHaveBeenLastCalledWith(tenant,'review',2));
  fireEvent.change(screen.getByLabelText('Situação'),{target:{value:'pending'}});await waitFor(()=>expect(mock.read).toHaveBeenLastCalledWith(tenant,'pending',1));
 });
 it('does not read financial jobs for a driver or a denied mixed profile',()=>{
  mock.role='driver';const view=mount();expect(screen.getByRole('alert')).toHaveTextContent('Acesso financeiro não permitido');expect(mock.read).not.toHaveBeenCalled();
  view.unmount();mock.role='operator';mock.access=false;mount();expect(mock.read).not.toHaveBeenCalled();
 });
});

it('explains actual compound review reasons without diagnosing every invalid amount as fractional cents',()=>{
 expect(fiscalQueueIssue('authorization_evidence_missing,invalid_receivable_amount')).toBe('Falta número, chave ou protocolo de autorização válido. O valor a receber está ausente ou inválido; confira o valor fiscal e a precisão em centavos.');
 expect(fiscalQueueIssue('retention_data_missing,nfse_net_amount_conflict')).toContain('retenções');
 expect(fiscalQueueIssue('authorization_not_active')).toContain('não possui autorização ativa');
 expect(fiscalQueueIssue('invalid_receivable_amount')).not.toContain('fração');
});
