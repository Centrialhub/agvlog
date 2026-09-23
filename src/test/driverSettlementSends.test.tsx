import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,expect,it,vi} from 'vitest';
import {DriverSettlementSends} from '@/components/financial/DriverSettlementSends';
const m=vi.hoisted(()=>({tenant:'00000000-0000-4000-8000-000000000001',actor:'00000000-0000-4000-8000-000000000002',driver:'00000000-0000-4000-8000-000000000003',read:vi.fn(),entry:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:m.actor}})}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:m.tenant},currentRole:'operator'})}));
vi.mock('@/hooks/useFinanceLedger',()=>({useFinanceAccess:()=>({isFetchedAfterMount:true,data:true})}));
vi.mock('@/lib/financial/ledgerClient',async original=>({...await original<object>(),readFinanceMovements:m.read}));
vi.mock('@/components/financial/MovementEntryDialog',()=>({MovementEntryDialog:(props:unknown)=>{m.entry(props);return <p>Diálogo de envio</p>;}}));
beforeEach(()=>{vi.clearAllMocks();m.read.mockImplementation(async(_tenant,filters)=>({page:filters.page,page_size:30,total:31,outflow_cents:'4000',voided_outflow_cents:'0',rows:[]}));});
function mount(tenant=m.tenant){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><DriverSettlementSends tenant={tenant} driver={{id:m.driver,name:'Motorista QA'}}/></QueryClientProvider>);}
it('scopes every page and date query to the selected driver and opens the existing entry with tenant and actor',async()=>{
 mount();await screen.findByText(/31 registros/);expect(m.read).toHaveBeenLastCalledWith(m.tenant,expect.objectContaining({driver_id:m.driver,direction:'out',page:1,page_size:30}));
 fireEvent.click(screen.getByText('Próximos envios'));await waitFor(()=>expect(m.read).toHaveBeenLastCalledWith(m.tenant,expect.objectContaining({driver_id:m.driver,page:2})));
 fireEvent.change(screen.getByLabelText('Envios de'),{target:{value:'2026-09-01'}});fireEvent.click(screen.getByText('Filtrar envios'));await waitFor(()=>expect(m.read).toHaveBeenLastCalledWith(m.tenant,expect.objectContaining({driver_id:m.driver,from:'2026-09-01',page:1})));
 fireEvent.click(screen.getByText('Registrar envio realizado'));expect(m.entry).toHaveBeenLastCalledWith(expect.objectContaining({tenant:m.tenant,actor:m.actor,initialDriver:{id:m.driver,name:'Motorista QA'}}));
 expect(screen.getByText(/não comprova vínculo exclusivo/)).toBeInTheDocument();
});
it('does not read another company through a stale settlement',()=>{mount('00000000-0000-4000-8000-000000000004');expect(screen.getByRole('alert')).toHaveTextContent('Selecione a empresa');expect(m.read).not.toHaveBeenCalled();});
it('refreshes the settlement list and bank reconciliation candidates after recording a send',async()=>{
 const invalidation=vi.spyOn(QueryClient.prototype,'invalidateQueries');mount();await screen.findByText(/31 registros/);
 fireEvent.click(screen.getByText('Registrar envio realizado'));
 const props=m.entry.mock.calls.at(-1)?.[0] as {onRecorded:()=>void};
 await act(async()=>{props.onRecorded();});
 for(const prefix of ['finance-movements','finance-audit','finance-reconciliation-options','finance-automatic-reconciliation'])expect(invalidation).toHaveBeenCalledWith({queryKey:[prefix,m.tenant]});
 expect(screen.getByRole('status')).toHaveTextContent('Confira a movimentação no extrato');
});
it('mantém o último resultado e bloqueia um intervalo de datas invertido',async()=>{
 mount();await screen.findByText(/31 registros/);expect(m.read).toHaveBeenCalledTimes(1);
 fireEvent.change(screen.getByLabelText('Envios de'),{target:{value:'2026-09-20'}});
 fireEvent.change(screen.getByLabelText('Envios até'),{target:{value:'2026-09-01'}});
 expect(screen.getByRole('alert')).toHaveTextContent('data inicial');
 expect(screen.getByRole('button',{name:'Filtrar envios'})).toBeDisabled();
 expect(screen.getByText(/31 registros/)).toBeInTheDocument();
 expect(m.read).toHaveBeenCalledTimes(1);
 fireEvent.change(screen.getByLabelText('Envios até'),{target:{value:'2026-09-30'}});
 fireEvent.click(screen.getByRole('button',{name:'Filtrar envios'}));
 await waitFor(()=>expect(m.read).toHaveBeenLastCalledWith(m.tenant,expect.objectContaining({from:'2026-09-20',to:'2026-09-30'})));
});
