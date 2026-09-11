import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {ReceivablePortfolioCard,ReceivablePortfolioStatus} from '@/components/financial/ReceivablePortfolio';
import {useReceivablePortfolio} from '@/hooks/useReceivablePortfolio';
const read=vi.hoisted(()=>vi.fn());vi.mock('@/lib/financial/receivablePortfolioClient',()=>({readReceivablePortfolio:read}));
const summary={as_of:'2026-09-10',total_titles:1501,canceled_titles:4,invalid_titles:0,totals_valid:true,nominal_cents:'100000',received_allocated_cents:'40000',open_cents:'60000',overdue_cents:'10000',status_rows:[{status:'partial',count:1501,nominal_cents:'100000',received_allocated_cents:'40000',open_cents:'60000'}]};
beforeEach(()=>{vi.clearAllMocks();read.mockResolvedValue(summary);});afterEach(cleanup);
function Fixture({client=null}:{client?:string|null}){const state=useReceivablePortfolio('tenant','actor',{from:null,to:null,client});return <><ReceivablePortfolioCard state={state}/><ReceivablePortfolioStatus state={state} onManage={()=>{}}/></>;}
function open(cache=new QueryClient()){return render(<QueryClientProvider client={cache}><Fixture/></QueryClientProvider>);}
it('shows residual open and partial allocations, including all server titles and excluding cancelled nominal values',async()=>{
 open();expect(await screen.findByText(/1501 título\(s\) ativo/)).toHaveTextContent('4 cancelado(s) excluído(s)');expect(screen.getAllByText('R$ 600,00').length).toBeGreaterThan(0);expect(screen.getAllByText('R$ 400,00').length).toBeGreaterThan(0);expect(screen.getByRole('img')).toHaveAccessibleName('60% do valor nominal em aberto');expect(screen.getByText(/não representam entradas bancárias no período/)).toBeInTheDocument();expect(read).toHaveBeenCalledWith('tenant',{from:null,to:null,client:null});
});
it('shows unavailable monetary totals and no bars when any title needs revision',async()=>{
 read.mockResolvedValue({...summary,invalid_titles:2,totals_valid:false,nominal_cents:null,received_allocated_cents:null,open_cents:null,overdue_cents:null,status_rows:[{status:'unknown',count:2,nominal_cents:null,received_allocated_cents:null,open_cents:null}]});open();expect(await screen.findByRole('alert')).toHaveTextContent('2 título(s) precisam de revisão');expect(screen.getByRole('alert')).toHaveTextContent('sem data válida');expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
it('hides stale money during refresh and shows an error instead of zero after failure',async()=>{
 const cache=new QueryClient();open(cache);await screen.findByText(/1501 título/);let reject!:(e:Error)=>void;read.mockImplementationOnce(()=>new Promise((_,no)=>{reject=no;}));await act(async()=>{void cache.invalidateQueries({queryKey:['finance-receivable-portfolio']});});await waitFor(()=>expect(screen.queryByText(/1501 título/)).not.toBeInTheDocument());expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();await act(async()=>{reject(new Error('offline'));});expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar');expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument();
});
