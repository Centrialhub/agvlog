import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AutomaticReconciliationStatus} from '@/components/financial/AutomaticReconciliationStatus';
const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('@/lib/financial/ledgerClient',()=>({readAutomaticReconciliationStatus:mock.read}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),statement=crypto.randomUUID();
beforeEach(()=>{vi.clearAllMocks();mock.read.mockResolvedValue({status:'pending',scheduler_active:false,matched_count:0,issue:null,updated_at:null});});afterEach(cleanup);
function open(){render(<QueryClientProvider client={new QueryClient()}><AutomaticReconciliationStatus tenant={tenant} actor={actor} statement={statement}/></QueryClientProvider>);fireEvent.click(screen.getByRole('button',{name:'Acompanhar conciliação automática'}));}
it('exposes an inactive scheduler rather than leaving the user expecting processing',async()=>{
 open();expect(await screen.findByRole('alert')).toHaveTextContent('processamento automático está desativado');expect(mock.read).toHaveBeenCalledWith(tenant,statement);
});
it('does not represent a completed scan as complete reconciliation',async()=>{
 mock.read.mockResolvedValue({status:'complete',scheduler_active:true,matched_count:2,issue:null,updated_at:null});open();
 await screen.findByText('Varredura concluída');expect(screen.getByText(/2 vínculo/)).toBeInTheDocument();expect(screen.getByText(/não significa que todas as linhas foram conciliadas/)).toBeInTheDocument();
});
it('explains account review without exposing internal error codes',async()=>{
 mock.read.mockResolvedValue({status:'review',scheduler_active:true,matched_count:0,issue:'native_account_ambiguous',updated_at:null});open();
 expect(await screen.findByRole('alert')).toHaveTextContent('não corresponde a um cadastro único');expect(screen.queryByText('native_account_ambiguous')).not.toBeInTheDocument();
});
it('refreshes cached account evidence when the worker finishes without repeating for unchanged status',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{staleTime:Infinity}}});
 const key=['finance-account-period',tenant,actor,'account'];
 client.setQueryData(key,{unmatched_bank_count:2});
 render(<QueryClientProvider client={client}><AutomaticReconciliationStatus tenant={tenant} actor={actor} statement={statement}/></QueryClientProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Acompanhar conciliação automática'}));
 await screen.findByRole('alert');
 client.setQueryData(key,{unmatched_bank_count:2});
 mock.read.mockResolvedValue({status:'complete',scheduler_active:true,matched_count:2,issue:null,updated_at:'2026-09-10T12:00:00Z'});
 fireEvent.click(screen.getByRole('button',{name:'Atualizar andamento'}));
 await screen.findByText('Varredura concluída');
 await waitFor(()=>expect(client.getQueryState(key)?.isInvalidated).toBe(true));
 client.setQueryData(key,{unmatched_bank_count:0});
 fireEvent.click(screen.getByRole('button',{name:'Atualizar andamento'}));
 await waitFor(()=>expect(mock.read).toHaveBeenCalledTimes(3));
 expect(client.getQueryState(key)?.isInvalidated).toBe(false);
});
