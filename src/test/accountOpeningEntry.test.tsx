import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AccountOpeningEntry} from '@/components/financial/AccountOpeningEntry';
const mock=vi.hoisted(()=>({read:vi.fn(),integrity:vi.fn()}));
vi.mock('@/lib/financial/accountDirectoryClient',()=>({readAccountDirectory:mock.read}));
vi.mock('@/lib/financial/legacyIntegrityClient',()=>({readLegacyIntegrity:mock.integrity}));
vi.mock('@/components/financial/AccountOpeningReview',()=>({AccountOpeningReview:({account,from,to}:{account:string;from:string;to:string})=><p>Abertura {account} de {from} até {to}</p>}));
const result={rows:[{id:'cash',name:'Caixa sede',account_type:'cash',active:false}],total:21,page:1,page_size:20};
beforeEach(()=>{vi.clearAllMocks();mock.read.mockResolvedValue(result);mock.integrity.mockResolvedValue({total:0,counts_by_issue:{},identified_account:{total:0,rows:[]},unknown_account:{total:0,rows:[]}});});afterEach(cleanup);
function open(){render(<QueryClientProvider client={new QueryClient()}><AccountOpeningEntry tenant="tenant" actor="actor"/></QueryClientProvider>);fireEvent.click(screen.getByRole('button',{name:'Saldos e abertura por conta'}));}
it('opens a physical account without any statement and applies dates only on consultation',async()=>{
 open();fireEvent.click(await screen.findByRole('button',{name:'Caixa sede · Caixa físico · Inativa'}));
 const prior=screen.getByText(/^Abertura cash/).textContent;
 fireEvent.change(screen.getByLabelText('Início do saldo registrado'),{target:{value:'2026-01-01'}});
 fireEvent.change(screen.getByLabelText('Fim do saldo registrado'),{target:{value:'2026-01-31'}});
 expect(screen.getByText(/^Abertura cash/).textContent).toBe(prior);
 fireEvent.click(screen.getByRole('button',{name:'Consultar saldos'}));
 expect(screen.getByText('Abertura cash de 2026-01-01 até 2026-01-31')).toBeInTheDocument();
});
it('pages and searches on the server, retaining the chosen account for history',async()=>{
 open();fireEvent.click(await screen.findByRole('button',{name:'Caixa sede · Caixa físico · Inativa'}));
 mock.read.mockResolvedValue({...result,page:2,rows:[]});fireEvent.click(screen.getByRole('button',{name:'Próximas contas'}));
 await waitFor(()=>expect(mock.read).toHaveBeenCalledWith('tenant','',2));
 await screen.findByText('Nenhuma conta encontrada.');expect(screen.getByText(/^Abertura cash/)).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Buscar conta pelo nome'),{target:{value:'Banco'}});fireEvent.click(screen.getByRole('button',{name:'Buscar contas'}));
 await waitFor(()=>expect(mock.read).toHaveBeenCalledWith('tenant','Banco',1));
});
it('allows company-wide integrity review even when no bank account exists',async()=>{
 mock.read.mockResolvedValue({...result,total:0,rows:[]});open();await screen.findByText('Nenhuma conta encontrada.');
 fireEvent.click(screen.getByRole('button',{name:'Consultar integridade dos registros antigos'}));
 await waitFor(()=>expect(mock.integrity).toHaveBeenCalledWith('tenant',1));
 expect(await screen.findByText(/Uma lista vazia não aprova/)).toBeInTheDocument();
});
it('shows the company integrity panel once when an account is selected',async()=>{
 open();fireEvent.click(await screen.findByRole('button',{name:'Caixa sede · Caixa físico · Inativa'}));
 expect(screen.getAllByRole('button',{name:'Consultar integridade dos registros antigos'})).toHaveLength(1);
});
it('shows the cash closing entry only for physical accounts and keeps banking review for bank accounts',async()=>{open();fireEvent.click(await screen.findByRole('button',{name:'Caixa sede · Caixa físico · Inativa'}));expect(screen.getByRole('button',{name:'Contagem e fechamento do caixa físico'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Conferir fechamento e histórico bancário'})).not.toBeInTheDocument();cleanup();mock.read.mockResolvedValue({...result,rows:[{id:'bank',name:'Banco principal',account_type:'checking',active:true}]});open();fireEvent.click(await screen.findByRole('button',{name:'Banco principal · Conta bancária'}));expect(screen.getByRole('button',{name:'Conferir fechamento e histórico bancário'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Contagem e fechamento do caixa físico'})).not.toBeInTheDocument();});
