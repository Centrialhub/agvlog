import {cleanup,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import {TransferPeriodPosition} from '@/components/financial/TransferPeriodPosition';
const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('@/lib/financial/ledgerClient',()=>({readTransferPeriod:mock.read}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
function open(){render(<QueryClientProvider client={new QueryClient()}><TransferPeriodPosition tenant="tenant" actor="actor" account="account" cutoff="2026-01-31"/></QueryClientProvider>);}
it('explains a later arrival as transit at the selected cutoff without calling it available cash',async()=>{
 mock.read.mockResolvedValue({total:1,unlinked_count:0,outbound_transit_cents:'50000',inbound_transit_cents:'0',rows:[{movement_id:'movement',source_name:'Origem',destination_name:'Destino',amount_cents:50000,status:'arrived_after_cutoff',occurred_on:'2026-01-31',arrived_on:'2026-02-01'}]});
 open();expect(await screen.findByText('Chegou depois da data de corte')).toBeInTheDocument();expect(screen.getByText(/Chegada: 01\/02\/2026/)).toBeInTheDocument();expect(screen.getByText(/não são saldo disponível/)).toBeInTheDocument();expect(mock.read).toHaveBeenCalledWith('tenant','account','2026-01-31',1);
});
it('does not present a failed lookup as no pending transfers',async()=>{
 mock.read.mockRejectedValue(new Error('denied'));open();expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conferir');expect(screen.queryByText(/Nenhuma pendência/)).not.toBeInTheDocument();
});
