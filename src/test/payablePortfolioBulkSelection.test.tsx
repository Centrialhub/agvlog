import {fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,expect,it,vi} from 'vitest';

const api=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('@/lib/financial/payablePortfolioClient',()=>({readPayablePortfolio:api.read}));
vi.mock('@/components/financial/PayableBulkSettlementDialog',()=>({PayableBulkSettlementDialog:({titles}:{titles:{payable_id:string}[]})=><p>Diálogo em lote com {titles.length} títulos</p>}));
import {PayablePortfolioWorkspace} from '@/components/financial/PayablePortfolioPanel';

const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),revision='a'.repeat(32);
const title=(description:string)=>({source_table:'payables' as const,source_id:crypto.randomUUID(),status:'approved',description,supplier_id:null,supplier_name:'Fornecedor QA',due_on:'2026-09-30',created_on:'2026-09-01',date_in_range:true,origin:{source_table:null,source_id:null},declared_amount:'100.00',declared_paid:'0.00',payment_ids:[],issues:[],valid:true,nominal_cents:'10000',paid_cents:'0',open_cents:'10000',source_revision:revision});
const rows=[title('Nota A'),title('Nota B')];

beforeEach(()=>{localStorage.clear();api.read.mockResolvedValue({version:1,tenant_id:tenant,basis:'current_operational',date_basis:'due_date',from:null,to:null,category:null,supplier_id:null,search:null,status_filter:null,source_filter:null,as_of:'2026-09-14',revision,page:1,page_size:30,total_titles:2,cancelled_titles:0,invalid_titles:0,undated_titles:0,totals_valid:true,nominal_cents:'20000',paid_cents:'0',open_cents:'20000',overdue_cents:'0',status_counts:[{status:'approved',count:2}],issue_counts:[],rows});});

it('selects multiple eligible titles from the canonical portfolio and opens the bulk review',async()=>{
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><PayablePortfolioWorkspace tenant={tenant} actor={actor}/></QueryClientProvider>);
  const action=await screen.findByRole('button',{name:'Baixar títulos selecionados (0)'});expect(action).toBeDisabled();
  await screen.findByText('Nota A');
  fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar título — Nota A'}));
  fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar título — Nota B'}));
  expect(screen.getByRole('button',{name:'Baixar títulos selecionados (2)'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'Baixar títulos selecionados (2)'}));
  expect(screen.getByText('Diálogo em lote com 2 títulos')).toBeInTheDocument();
});
it('selects unidentified beneficiaries for exclusion but not for bulk settlement',async()=>{
  const base=await api.read();
  api.read.mockResolvedValue({...base,rows:rows.map(row=>({...row,supplier_name:'  '}))});
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><PayablePortfolioWorkspace tenant={tenant} actor={actor}/></QueryClientProvider>);
  await screen.findByText('Nota A');
  expect(screen.getByRole('checkbox',{name:'Selecionar título — Nota A'})).toBeEnabled();fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar título — Nota A'}));
  expect(screen.getByRole('checkbox',{name:'Selecionar título — Nota B'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'Baixar títulos selecionados (0)'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Excluir selecionados (1)'})).toBeEnabled();
  expect(screen.getAllByText('Informe o favorecido para permitir baixa em lote.')).toHaveLength(2);
});
it('discards selected balances when the portfolio revision changes',async()=>{
  const base=await api.read();api.read.mockReset().mockResolvedValueOnce({...base,total_titles:31}).mockRejectedValueOnce({code:'40001',message:'finance_payable_portfolio_changed'}).mockResolvedValue({...base,revision:'b'.repeat(32),rows:rows.map(row=>({...row,open_cents:'15000'}))});
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><PayablePortfolioWorkspace tenant={tenant} actor={actor}/></QueryClientProvider>);await screen.findByText('Nota A');fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar título — Nota A'}));fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar título — Nota B'}));fireEvent.click(screen.getByRole('button',{name:'Próximos títulos a pagar'}));
  expect(await screen.findByText(/selecione novamente os títulos/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Baixar títulos selecionados (0)'})).toBeDisabled();
});

it('selects pending and cancelled titles and supports selecting the whole page',async()=>{
  const base=await api.read();api.read.mockResolvedValue({...base,rows:[{...rows[0],status:'pending'},{...rows[1],status:'cancelled',open_cents:'0'}]});
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><PayablePortfolioWorkspace tenant={tenant} actor={actor}/></QueryClientProvider>);
  await screen.findByText('Nota A');fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar todos desta página'}));
  expect(screen.getByRole('checkbox',{name:'Selecionar título — Nota A'})).toBeChecked();
  expect(screen.getByRole('checkbox',{name:'Selecionar título — Nota B'})).toBeChecked();
  expect(screen.getByRole('button',{name:'Excluir selecionados (2)'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'Baixar títulos selecionados (0)'})).toBeDisabled();
});
