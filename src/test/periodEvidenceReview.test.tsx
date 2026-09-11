import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PeriodEvidenceReview} from '@/components/financial/PeriodEvidenceReview';
const mock=vi.hoisted(()=>({read:vi.fn(),record:vi.fn()}));
vi.mock('@/lib/financial/periodEvidenceClient',async original=>({...await original<typeof import('@/lib/financial/periodEvidenceClient')>(),readPeriodEvidence:mock.read,recordPeriodEvidence:mock.record}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),account=crypto.randomUUID();
const result={version:1,tenant_id:tenant,account_id:account,from:'2026-09-01',to:'2026-09-30',revision:'revision',qualified_source_count:2,missing_declared_days:0,declaration_status:'declared_full_days',opening_balance_cents:'10000',closing_balance_cents:'10000',difference_cents:'0',arithmetic_status:'equal',anchors:[]};
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();mock.read.mockResolvedValue(result);mock.record.mockResolvedValue({review_id:crypto.randomUUID()});});afterEach(cleanup);
function open(){render(<QueryClientProvider client={new QueryClient()}><PeriodEvidenceReview tenant={tenant} actor={actor} account={account} from="2026-09-01" to="2026-09-30"/></QueryClientProvider>);fireEvent.click(screen.getByRole('button',{name:'Examinar evidências de saldo'}));}
it('shows equal arithmetic as limited evidence and records the reviewed revision',async()=>{
 open();await screen.findByText(/Abertura \+ movimentação identificada/);expect(screen.getByText(/não comprovam autenticidade ou ausência de omissões/)).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Observações da revisão'),{target:{value:'Conferidos os dois arquivos e seus saldos'}});fireEvent.click(screen.getByRole('button',{name:'Registrar revisão das evidências'}));
 await screen.findByText(/Revisão registrada:/);expect(mock.record.mock.calls[0][0]).toMatchObject({tenant_id:tenant,account_id:account,revision:'revision',reason:'Conferidos os dois arquivos e seus saldos'});
 expect(screen.getByText(/O período continua aberto/)).toBeInTheDocument();
});
it('replays the identical durable request after a lost response and remount',async()=>{
 mock.record.mockRejectedValueOnce(new Error('network'));open();await screen.findByLabelText('Observações da revisão');
 fireEvent.change(screen.getByLabelText('Observações da revisão'),{target:{value:'Conferência com pendências'}});fireEvent.click(screen.getByRole('button',{name:'Registrar revisão das evidências'}));
 await screen.findByText(/Não foi possível confirmar/);const command=mock.record.mock.calls[0][0];cleanup();open();
 fireEvent.click(await screen.findByRole('button',{name:'Retomar revisão enviada'}));await screen.findByText(/Revisão registrada:/);expect(mock.record.mock.calls[1][0]).toEqual(command);
});
it('refuses to submit without durable storage',async()=>{
 open();await screen.findByLabelText('Observações da revisão');fireEvent.change(screen.getByLabelText('Observações da revisão'),{target:{value:'Revisão em curso'}});
 const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
 fireEvent.click(screen.getByRole('button',{name:'Registrar revisão das evidências'}));await waitFor(()=>expect(mock.record).not.toHaveBeenCalled());expect(screen.getByText(/A revisão não foi enviada/)).toBeInTheDocument();spy.mockRestore();
});
it('preserves a corrupt saved request and blocks new submissions',async()=>{
 const key=`finance-period-evidence:${tenant}:${actor}:${account}:2026-09-01:2026-09-30`;sessionStorage.setItem(key,'{broken');
 open();await screen.findByLabelText('Observações da revisão');expect(screen.getByRole('alert')).toHaveTextContent('Novas revisões estão bloqueadas');
 fireEvent.change(screen.getByLabelText('Observações da revisão'),{target:{value:'Nova tentativa indevida'}});
 expect(screen.getByRole('button',{name:'Registrar revisão das evidências'})).toBeDisabled();expect(sessionStorage.getItem(key)).toBe('{broken');expect(mock.record).not.toHaveBeenCalled();
});
