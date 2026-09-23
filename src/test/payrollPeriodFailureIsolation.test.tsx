import {fireEvent,render,screen} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import Payroll from '@/pages/Payroll';

const state=vi.hoisted(()=>({refetch:vi.fn()}));
vi.mock('@/hooks/usePayroll',()=>({
 PAYROLL_PAYMENT_STATUS_LABELS:{},PAYROLL_PERIOD_STATUS_LABELS:{},
 usePayrollPeriods:()=>({data:undefined,isLoading:false,error:new Error('offline'),refetch:state.refetch}),
}));
vi.mock('@/hooks/useListFilters',()=>({useListFilters:()=>({filters:{search:'',status:'all',payment:'all'},setFilter:vi.fn(),resetFilters:vi.fn(),activeCount:0})}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant-a'}})}));
vi.mock('@/components/financial/payroll/PayrollAdvances',()=>({
 AdvancesTable:()=> <p>Adiantamentos disponíveis</p>,
 RegisterAdvanceDialog:({open}:{open:boolean})=>open?<p>Cadastro de adiantamento aberto</p>:null,
}));
vi.mock('@/components/financial/payroll/PayrollEntryDrawer',()=>({EntryDrawer:()=>null}));
vi.mock('@/components/financial/payroll/PayrollGeneratePeriodDialog',()=>({GeneratePeriodDialog:()=>null}));
vi.mock('@/components/financial/payroll/PayrollPeriodEntries',()=>({PeriodEntries:()=>null}));

beforeEach(()=>state.refetch.mockClear());

it('mantém adiantamentos acessíveis quando apenas a consulta de períodos falha',()=>{
 render(<Payroll/>);
 expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível conferir os períodos');
 fireEvent.click(screen.getByRole('button',{name:'Atualizar períodos'}));
 expect(state.refetch).toHaveBeenCalledOnce();
 expect(screen.getByRole('tab',{name:'Adiantamentos'})).not.toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Adiantamento'}));
 expect(screen.getByText('Cadastro de adiantamento aberto')).toBeInTheDocument();
});
