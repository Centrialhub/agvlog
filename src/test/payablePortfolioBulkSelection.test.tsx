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
  fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar para baixa em lote — Nota A'}));
  fireEvent.click(screen.getByRole('checkbox',{name:'Selecionar para baixa em lote — Nota B'}));
  expect(screen.getByRole('button',{name:'Baixar títulos selecionados (2)'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'Baixar títulos selecionados (2)'}));
  expect(screen.getByText('Diálogo em lote com 2 títulos')).toBeInTheDocument();
});
