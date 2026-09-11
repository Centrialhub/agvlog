import {render,screen,within} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {PayrollPeriod} from '../hooks/usePayroll';
const state=vi.hoisted(()=>({error:null as Error|null,rows:[] as unknown[]}));
vi.mock('@/hooks/usePayroll',()=>({
 usePayrollEntries:()=>({data:state.rows,isLoading:false,error:state.error}),
 useApprovePayrollPeriod:()=>({}),useClosePayrollPeriod:()=>({}),useGeneratePayrollPeriod:()=>({}),
 PAYROLL_PERIOD_STATUS_LABELS:{approved:'Aprovada'},PAYROLL_PAYMENT_STATUS_LABELS:{},
}));
vi.mock('@/hooks/useAlertStore',()=>({useScopedAlerts:()=>({confirmAction:vi.fn(),promptAction:vi.fn()})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({success:vi.fn(),error:vi.fn()})}));
vi.mock('@/hooks/useEmployees',()=>({useEmployees:()=>({data:[]})}));
import {PeriodEntries} from '../pages/Payroll';
const period={id:'period',status:'approved',period_name:'Setembro'} as PayrollPeriod;
beforeEach(()=>{
 state.error=null;
 state.rows=[{id:'entry',employees:{name:'Pessoa QA'},status:'approved',employee_id:'employee',entry_type:'employee',
 gross_amount:1000,discount_amount:0,already_paid_amount:200,amount_to_pay:800,
 payment_summary:{paid_via_titles:'300.00',remaining_amount:'500.00',status:'partial',issues:[]}}];
});
describe('payroll payment presentation',()=>{
 it('separates prior advances, recorded title payments and the remaining obligation',()=>{
  render(<PeriodEntries period={period} onOpenEntry={vi.fn()}/>);
  const row=screen.getByText('Pessoa QA').closest('tr')!;
  expect(within(row).getByText(/200,00/)).toBeInTheDocument();
  expect(within(row).getByText(/300,00/)).toBeInTheDocument();
  expect(within(row).getByText(/500,00/)).toBeInTheDocument();
  expect(within(row).queryByText(/800,00/)).not.toBeInTheDocument();
  expect(within(row).getByText('Parcial')).toBeInTheDocument();
  expect(screen.getByText(/confirmação pelo extrato bancário é uma conferência separada/)).toBeInTheDocument();
 });
 it('shows exceptions and suppresses stale values when the payment query fails',()=>{
  state.rows[0]={...(state.rows[0] as object),payment_summary:{paid_via_titles:'900',remaining_amount:'0',status:'review',issues:['overpaid']}};
  const view=render(<PeriodEntries period={period} onOpenEntry={vi.fn()}/>);
  expect(screen.getByText('Pagamento acima do saldo')).toBeInTheDocument();
  state.error=new Error('Falha de consulta');
  view.rerender(<PeriodEntries period={period} onOpenEntry={vi.fn()}/>);
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível conferir');
  expect(screen.queryByText('Pessoa QA')).not.toBeInTheDocument();
 });
});
