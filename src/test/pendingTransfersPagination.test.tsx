import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PendingTransfers} from '@/components/financial/PendingTransfers';

const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('@/lib/financial/ledgerClient',()=>({readPendingTransfers:mock.read}));
vi.mock('@/lib/financial/invalidateAccountReview',()=>({invalidateAccountReview:vi.fn()}));
vi.mock('@/components/financial/TransferStageDialog',()=>({TransferStageDialog:({onRecorded}:{onRecorded:()=>void})=><button onClick={onRecorded}>Concluir chegada simulada</button>}));

const tenant=crypto.randomUUID(),actor=crypto.randomUUID();
const row={id:crypto.randomUUID(),outgoing_id:crypto.randomUUID(),amount_cents:50000,occurred_on:'2026-01-01',source_account_id:crypto.randomUUID(),destination_account_id:crypto.randomUUID(),source_name:'Origem',destination_name:'Destino',bank_reference:null,created_by:actor,created_at:'2026-01-01T12:00:00Z'};

beforeEach(()=>{vi.clearAllMocks();mock.read.mockImplementation((_tenant:string,page:number)=>Promise.resolve({version:1,tenant_id:tenant,page,page_size:20,total:21,amount_cents:'1050000',rows:[{...row,id:`00000000-0000-4000-8000-0000000000${page.toString().padStart(2,'0')}`}] }));});
afterEach(()=>cleanup());

it('returns to the first page after an arrival removes a row from the mutable queue',async()=>{
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><PendingTransfers tenant={tenant} actor={actor}/></QueryClientProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Transferências em trânsito'}));
 await screen.findByText('Página 1 de 2');
 fireEvent.click(screen.getByRole('button',{name:'Próximas'}));
 await screen.findByText('Página 2 de 2');
 expect(mock.read).toHaveBeenLastCalledWith(tenant,2);
 fireEvent.click(screen.getByRole('button',{name:'Registrar chegada'}));
 fireEvent.click(screen.getByRole('button',{name:'Concluir chegada simulada'}));
 await waitFor(()=>expect(mock.read).toHaveBeenLastCalledWith(tenant,1));
 expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();
});
