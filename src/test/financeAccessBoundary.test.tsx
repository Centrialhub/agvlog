import {render,screen} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {FinanceAccessBoundary} from '@/components/financial/FinanceAccessBoundary';
import {isFinancialPath} from '@/lib/financial/financeRoutes';
const state=vi.hoisted(()=>({role:'operator',allowed:true,fresh:true,error:null as Error|null,pending:false}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentRole:state.role})}));
vi.mock('@/hooks/useFinanceLedger',()=>({useFinanceAccess:()=>({data:state.allowed,isFetchedAfterMount:state.fresh,error:state.error,isPending:state.pending,refetch:vi.fn()})}));
const child=vi.fn();function Sensitive(){child();return <p>Dados financeiros</p>;}
beforeEach(()=>{child.mockClear();state.role='operator';state.allowed=true;state.fresh=true;state.error=null;state.pending=false;});
describe('financial route boundary',()=>{
  it('does not mount financial children from a cached permission before fresh verification',()=>{
    state.fresh=false;const view=render(<FinanceAccessBoundary><Sensitive/></FinanceAccessBoundary>);expect(child).not.toHaveBeenCalled();
    state.fresh=true;view.rerender(<FinanceAccessBoundary><Sensitive/></FinanceAccessBoundary>);expect(screen.getByText('Dados financeiros')).toBeInTheDocument();
  });
  it('denies drivers and hides previously mounted content when the server rejects access',()=>{
    state.role='driver';const view=render(<FinanceAccessBoundary><Sensitive/></FinanceAccessBoundary>);expect(child).not.toHaveBeenCalled();
    state.role='admin';view.rerender(<FinanceAccessBoundary><Sensitive/></FinanceAccessBoundary>);expect(screen.getByText('Dados financeiros')).toBeInTheDocument();
    state.allowed=false;view.rerender(<FinanceAccessBoundary><Sensitive/></FinanceAccessBoundary>);expect(screen.queryByText('Dados financeiros')).not.toBeInTheDocument();
  });
  it('covers legacy financial routes and payroll without blocking operational driver pages',()=>{
    for(const path of ['/financial','/financial/audit','/payables','/receivables','/driver-settlements','/payroll','/closing-reports','/expense-approval'])expect(isFinancialPath(path)).toBe(true);
    expect(isFinancialPath('/driver/stops')).toBe(false);expect(isFinancialPath('/financial-other')).toBe(false);
  });
});
