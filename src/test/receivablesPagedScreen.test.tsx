import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import Receivables from '@/pages/Receivables';
const mock=vi.hoisted(()=>({read:vi.fn(),portfolio:vi.fn()}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/hooks/useClients',()=>({useClients:()=>({data:[]})}));
vi.mock('@/hooks/useReceivables',()=>({useCreateReceivable:()=>({}),useUpdateReceivable:()=>({}),RECEIVABLE_STATUS_LABELS:{pending:'Pendente'},RECEIVABLE_STATUSES:['pending']}));
vi.mock('@/lib/financial/receivablesPageClient',()=>({readReceivablesPage:mock.read}));
vi.mock('@/hooks/useReceivablePortfolio',()=>({useReceivablePortfolio:mock.portfolio,portfolioValue:(_state:unknown,key:string)=>key==='open_cents'?'R$ 10.050,00':'R$ 0,00'}));
vi.mock('@/components/financial/FiscalXmlUpload',()=>({default:()=>null}));
vi.mock('@/components/financial/ReceivablePaymentDialog',()=>({default:()=>null}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({})}));
const row={id:'title',tenant_id:'tenant',description:'Frete da página',amount:10,received_amount:0,status:'pending',client_id:null,client_invoice_id:null,due_date:'2026-01-01',clients:null};
beforeEach(()=>{vi.clearAllMocks();mock.portfolio.mockReturnValue({});mock.read.mockResolvedValue({rows:[row],page:1,page_size:50,total:1005,total_unfiltered:1005});});afterEach(cleanup);
function show(){render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><Receivables/></QueryClientProvider></MemoryRouter>);}
it('pages on the server and resets the page for a new filter without summing visible rows',async()=>{
 show();await screen.findByText('Frete da página');expect(screen.getByText('R$ 10.050,00')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Próximos títulos'}));await waitFor(()=>expect(mock.read).toHaveBeenCalledWith('tenant',expect.any(Object),2));
 await screen.findByText('Frete da página');fireEvent.change(screen.getByLabelText('Buscar título'),{target:{value:'cliente'}});
 await waitFor(()=>expect(mock.read).toHaveBeenCalledWith('tenant',expect.objectContaining({search:'cliente'}),1));
 expect(mock.portfolio).toHaveBeenLastCalledWith('tenant','actor',{from:null,to:null,client:null});expect(screen.getByText('R$ 10.050,00')).toBeInTheDocument();
});
it('does not display an empty successful result after a server error',async()=>{
 mock.read.mockRejectedValue(new Error('failed'));show();await screen.findByRole('alert');
 expect(screen.getByText('Consulta indisponível')).toBeInTheDocument();expect(screen.queryByText('Nenhum título encontrado')).not.toBeInTheDocument();
});
it('coalesces rapid typing into one server search',async()=>{
 show();await screen.findByText('Frete da página');mock.read.mockClear();
 const search=screen.getByLabelText('Buscar título');
 for(const value of ['c','cl','cli','cliente'])fireEvent.change(search,{target:{value}});
 expect(mock.read).not.toHaveBeenCalled();expect(screen.queryByText('Frete da página')).not.toBeInTheDocument();
 await waitFor(()=>expect(mock.read).toHaveBeenCalledTimes(1));
 expect(mock.read).toHaveBeenLastCalledWith('tenant',expect.objectContaining({search:'cliente'}),1);
});

it('sends the unloading origin filter to the server and resets pagination',async()=>{
 show();await screen.findByText('Frete da página');
 fireEvent.click(screen.getByRole('button',{name:'Próximos títulos'}));await waitFor(()=>expect(mock.read).toHaveBeenCalledWith('tenant',expect.any(Object),2));
 await screen.findByText('Frete da página');
 // The shared PointerEvent shim omits MouseEvent.button; provide the real mouse fields.
 const pointer=new MouseEvent('pointerdown',{bubbles:true,button:0,ctrlKey:false});
 Object.defineProperty(pointer,'pointerType',{value:'mouse'});
 const origin=screen.getByRole('combobox',{name:'Origem'});
 fireEvent(origin,pointer);
 expect(origin).toHaveAttribute('aria-expanded','true');

 // Inspect the actual portal, whose options are mounted by the pointer event.
 const listbox=document.querySelector<HTMLElement>('[role="listbox"]');
 expect(listbox).not.toBeNull();if(!listbox)throw new Error('Origin options did not open');
 const option=within(listbox).getByText('Reembolso de descarga');
 expect(option.closest('[role="option"]')).not.toBeNull();
 fireEvent.click(option);
 // fireEvent flushes the selection and query dispatch; no second asynchronous wait is needed.
 expect(mock.read).toHaveBeenLastCalledWith('tenant',expect.objectContaining({origin:'unloading'}),1);
});
