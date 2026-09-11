import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {LegacyUnresolvedInventory} from '@/components/financial/LegacyUnresolvedInventory';
const read=vi.hoisted(()=>vi.fn());vi.mock('@/lib/financial/legacyIntegrityClient',()=>({readLegacyIntegrity:read}));
const row={source_table:'payables_payments',source_id:'payment',date_status:'nonfinite',occurred_on:null,raw_date:'infinity',account_id:null,account_status:'unresolved',amount_cents:null,raw_amount:'NaN',direction:'out',issues:['source_date_nonfinite'],context:{origin_id:'orphan'}};
const empty={total:0,rows:[]},context={total:1,counts_by_issue:{source_date_nonfinite:1},identified_account:empty,unknown_account:{total:31,rows:[row]}};
beforeEach(()=>{vi.clearAllMocks();read.mockResolvedValue(context);});afterEach(cleanup);
function open(){render(<QueryClientProvider client={new QueryClient()}><LegacyUnresolvedInventory tenant="tenant" actor="actor"/></QueryClientProvider>);fireEvent.click(screen.getByRole('button',{name:'Consultar integridade dos registros antigos'}));}
it('shows undated records outside time/account filters without inventing money and paginates the larger group',async()=>{
 open();expect(await screen.findByText('Data inválida — fora dos filtros por período')).toBeInTheDocument();expect(screen.getByText('Valor não validado — sem conversão ou soma')).toBeInTheDocument();expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();expect(screen.getByText('Valor original: NaN')).toBeInTheDocument();expect(screen.getByText(/não some valores nem registros novamente/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Próxima integridade'}));await waitFor(()=>expect(read).toHaveBeenLastCalledWith('tenant',2));
});
it('does not turn an empty inventory into approval or closing',async()=>{
 read.mockResolvedValue({...context,total:0,identified_account:empty,unknown_account:empty,counts_by_issue:{}});open();expect(await screen.findByText(/Uma lista vazia não aprova/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Próxima integridade'})).toBeDisabled();expect(screen.queryByRole('button',{name:/Aprovar|Confirmar|Associar/})).not.toBeInTheDocument();
});
it('hides old rows after a failed refresh and distinguishes failure from empty data',async()=>{
 open();await screen.findByText('Valor original: NaN');read.mockRejectedValue(new Error('revoked'));fireEvent.click(screen.getByRole('button',{name:'Atualizar integridade dos registros antigos'}));expect(await screen.findByRole('alert')).toHaveTextContent('falha não representa ausência');expect(screen.queryByText('Valor original: NaN')).not.toBeInTheDocument();
});
