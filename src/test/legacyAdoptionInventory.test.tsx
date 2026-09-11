import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {LegacyAdoptionInventory} from '@/components/financial/LegacyAdoptionInventory';
const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('@/lib/financial/legacyInventoryClient',()=>({readLegacyInventory:mock.read}));
const unknown={source_table:'employee_advances',source_id:'advance',occurred_on:'2026-01-05',amount_cents:null,direction:'out',account_id:null,bank_transaction_id:null,reason:'paid_advance_without_payment_account_unresolved',context:{}};
const empty={page:1,page_size:30,total:0,counts_by_source:{},rows:[]};
beforeEach(()=>{vi.clearAllMocks();mock.read.mockResolvedValue({...empty,unknown_account:{...empty,total:31,rows:[unknown]},legacy_integration_status:'not_reviewed',can_close:false});});afterEach(cleanup);
function open(){render(<QueryClientProvider client={new QueryClient()}><LegacyAdoptionInventory tenant="tenant" actor="actor" account="account" from="2026-01-01" to="2026-01-31"/></QueryClientProvider>);fireEvent.click(screen.getByRole('button',{name:'Consultar registros antigos'}));}
it('keeps unidentified company records separate and does not fabricate a value from paid status',async()=>{
 open();await screen.findByText('Sem conta identificada: 31 registro(s) na empresa');expect(screen.getByText('Desta conta: 0 registro(s) a conferir')).toBeInTheDocument();
 expect(screen.getByText('Valor a esclarecer')).toBeInTheDocument();expect(screen.getByText(/Não some esses registros novamente/)).toBeInTheDocument();expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Próximas pendências'}));await waitFor(()=>expect(mock.read).toHaveBeenLastCalledWith('tenant','account','2026-01-01','2026-01-31',2));
});
it('does not certify adoption or closing when both lists are empty',async()=>{
 mock.read.mockResolvedValue({...empty,unknown_account:empty,legacy_integration_status:'not_reviewed',can_close:false});open();
 expect(await screen.findByText(/Uma lista vazia não comprova/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Próximas pendências'})).toBeDisabled();
});
it('hides old rows when a refresh fails',async()=>{
 open();await screen.findByText('Valor a esclarecer');mock.read.mockRejectedValue(new Error('revoked'));
 fireEvent.click(screen.getByRole('button',{name:'Atualizar pendências antigas'}));await screen.findByRole('alert');expect(screen.queryByText('Valor a esclarecer')).not.toBeInTheDocument();
});
it('keeps integrity review independent of temporal consultation and supports a single external panel',()=>{
 const cache=new QueryClient(),panel=(include:boolean)=><QueryClientProvider client={cache}><LegacyAdoptionInventory tenant="tenant" actor="actor" account="account" from="2026-01-01" to="2026-01-31" includeUnresolved={include}/></QueryClientProvider>;
 const view=render(panel(true));expect(screen.getByRole('button',{name:'Consultar integridade dos registros antigos'})).toBeInTheDocument();expect(mock.read).not.toHaveBeenCalled();view.rerender(panel(false));expect(screen.queryByRole('button',{name:'Consultar integridade dos registros antigos'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Consultar registros antigos'})).toBeInTheDocument();
});
