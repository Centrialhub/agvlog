import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AccountPeriodReview} from '@/components/financial/AccountPeriodReview';
const mock=vi.hoisted(()=>({read:vi.fn(),transfers:vi.fn()}));
vi.mock('@/lib/financial/ledgerClient',()=>({readAccountPeriodReview:mock.read,readTransferPeriod:mock.transfers}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),account=crypto.randomUUID();
const result={account_name:'Conta operação',from:'2026-09-01',to:'2026-09-30',bank:{count:2,in_cents:'10000',out_cents:'10000',net_cents:'0'},recorded:{count:2,in_cents:'20000',out_cents:'20000',net_cents:'0'},difference:{in_cents:'10000',out_cents:'10000',net_cents:'0'},unmatched_bank_count:2,unmatched_movement_count:2,unresolved_row_count:0,unverified_entry_count:0,evidence_review_count:0,cross_period_count:0,manual_group_count:0};
beforeEach(()=>{vi.clearAllMocks();mock.read.mockResolvedValue(result);mock.transfers.mockResolvedValue({total:0,unlinked_count:0,outbound_transit_cents:'0',inbound_transit_cents:'0',rows:[]});});afterEach(cleanup);
function open(){render(<QueryClientProvider client={new QueryClient()}><AccountPeriodReview tenant={tenant} actor={actor} account={account} from="2026-09-01" to="2026-09-30"/></QueryClientProvider>);fireEvent.click(screen.getByRole('button',{name:'Conferir conta no período'}));}
it('keeps missing links and provisional coverage visible despite equal net movement',async()=>{
 open();await screen.findByText(/2 transação\(ões\) bancária\(s\) sem vínculo válido/);
 expect(screen.getByRole('alert')).toHaveTextContent('decisão de fechamento e seu histórico são consultados');expect(screen.getByText(/Movimentação líquida não é saldo bancário/)).toBeInTheDocument();
 expect(mock.read).toHaveBeenCalledWith(tenant,account,'2026-09-01','2026-09-30');
});
it('applies a new period only on explicit consultation and hides stale data after failure',async()=>{
 open();await screen.findByText(/Conta operação/);fireEvent.change(screen.getByLabelText('Início da conferência'),{target:{value:'2026-09-05'}});expect(mock.read).toHaveBeenCalledTimes(1);
 mock.read.mockRejectedValue(new Error('no access'));fireEvent.click(screen.getByRole('button',{name:'Consultar período'}));
 await waitFor(()=>expect(mock.read).toHaveBeenCalledWith(tenant,account,'2026-09-05','2026-09-30'));
 expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conferir');expect(screen.queryByText(/Conta operação/)).not.toBeInTheDocument();
});
