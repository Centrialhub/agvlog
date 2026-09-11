import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import {ReconciliationStatementImport} from '@/components/financial/ReconciliationStatementImport';
import type {StatementVerificationResult} from '@/lib/financial/statementImportContract';
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/components/financial/StatementImportDialog',()=>({StatementImportDialog:({initial,onImported}:{initial:{account:string;start:string;end:string};onImported:(result:Partial<StatementVerificationResult>)=>void})=><div>
 <p>{initial.account} {initial.start} {initial.end}</p>
 {(['rows_match','rows_mismatch','unreadable'] as const).map(source_verification=><button key={source_verification} onClick={()=>onImported({source_verification})}>{source_verification}</button>)}
</div>}));
afterEach(cleanup);
it.each([
 ['rows_match','Original preservado e linhas conferidas. A conciliação deve ser acompanhada em Extratos.'],
 ['rows_mismatch','Original preservado com divergências na leitura. Revise a importação em Extratos.'],
 ['unreadable','Original preservado, mas não foi possível conferir sua leitura. Revise a importação em Extratos.'],
])('distinguishes source verification %s from bank reconciliation', (outcome,message)=>{
 const client=new QueryClient(),invalidate=vi.spyOn(client,'invalidateQueries');
 render(<MemoryRouter><QueryClientProvider client={client}><ReconciliationStatementImport account="principal" start="2026-09-01" end="2026-09-10"/></QueryClientProvider></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Importar extrato'}));
 expect(screen.getByText('principal 2026-09-01 2026-09-10')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:outcome}));
 expect(screen.getByRole('status')).toHaveTextContent(message);
 expect(screen.getByRole('link',{name:'Abrir extratos e conferência'})).toHaveAttribute('href','/financial/statements');
 expect(invalidate).toHaveBeenCalledWith({queryKey:['finance-statements','tenant','actor']});
});
