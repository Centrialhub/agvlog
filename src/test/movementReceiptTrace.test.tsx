import {act,cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import {MovementReceiptTrace} from '@/components/financial/MovementReceiptTrace';
const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('@/lib/financial/ledgerClient',()=>({readMovementReceiptTrace:mock.read}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
function open(cache=new QueryClient()){render(<QueryClientProvider client={cache}><MovementReceiptTrace tenant="tenant" actor="actor" movement="movement" onClose={()=>{}}/></QueryClientProvider>);}
it('keeps the manual author and reason visible without claiming money was removed',async()=>{
 mock.read.mockResolvedValue({total:1,rows:[{origin:'canonical',link_id:'command',command_id:'command',association:null,association_reversal:null,reference:'Título 123',amount_cents:50000,action:'receive',created_at:'2026-09-10T00:00:00Z',credit:null,reversal_id:null,correction:{actor_name:'Maria',actor_id:'actor-id',reason:'Baixa atribuída ao título errado',created_at:'2026-09-10T01:00:00Z'}}]});
 open();expect(await screen.findByText(/Correção manual por Maria/)).toBeInTheDocument();
 expect(screen.getByText('Baixa atribuída ao título errado')).toBeInTheDocument();expect(screen.getByText('Responsável: actor-id')).toBeInTheDocument();expect(screen.getByText('O dinheiro registrado foi preservado.')).toBeInTheDocument();
 expect(mock.read).toHaveBeenCalledWith('tenant','movement',1);
});
it('separates adoption reversal from canonical correction and a real money refund, retaining both authors',async()=>{
 mock.read.mockResolvedValue({total:21,rows:[{origin:'legacy_adoption',link_id:'legacy-link',command_id:null,reference:'Título antigo',amount_cents:50000,action:'receive',created_at:'2026-09-10T00:00:00Z',correction:null,credit:null,reversal_id:'real-refund',association:{actor_name:'Ana',actor_id:'actor-ana',reason:'Recebimento e entrada conferidos',created_at:'2026-09-10T00:00:00Z',existing_receipt_confirmed:true},association_reversal:{id:'reversal',actor_name:'Paulo',actor_id:'actor-paulo',reason:'Entrada selecionada incorretamente',created_at:'2026-09-10T01:00:00Z'}}]});open();expect(await screen.findByText('Associação antiga desfeita — recebimento preservado')).toBeInTheDocument();expect(screen.getByText(/Associação manual por Ana/)).toBeInTheDocument();expect(screen.getByText(/Associação desfeita manualmente por Paulo/)).toBeInTheDocument();expect(screen.getByText('Esta correção preservou o recebimento e não reabriu o título.')).toBeInTheDocument();expect(screen.getByText(/devolução de dinheiro registrada separadamente/)).toBeInTheDocument();expect(screen.queryByText(/não compõe mais o recebido/)).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Próxima'}));await waitFor(()=>expect(mock.read).toHaveBeenCalledWith('tenant','movement',2));
});
it('hides previous history while refreshing and after a failed refresh',async()=>{
 const cache=new QueryClient();mock.read.mockResolvedValue({total:0,rows:[]});open(cache);await screen.findByText(/Nenhum vínculo/);let reject!:(reason:Error)=>void;mock.read.mockImplementationOnce(()=>new Promise((_,no)=>{reject=no;}));await act(async()=>{void cache.invalidateQueries({queryKey:['finance-movement-receipts']});});await waitFor(()=>expect(screen.queryByText(/Nenhum vínculo/)).not.toBeInTheDocument());await act(async()=>{reject(new Error('offline'));});expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar');
});
it('shows a failed lookup instead of an empty history',async()=>{
 mock.read.mockRejectedValue(new Error('denied'));open();
 expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar');expect(screen.queryByText(/Nenhum vínculo/)).not.toBeInTheDocument();
});
