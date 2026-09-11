import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ReconciliationHistory} from '@/components/financial/ReconciliationHistory';
import {ReconciliationReversal} from '@/components/financial/ReconciliationReversal';
const mock=vi.hoisted(()=>({history:vi.fn(),reverse:vi.fn()}));
vi.mock('@/lib/financial/ledgerClient',async original=>({...await original<object>(),readReconciliationHistory:mock.history,reverseBankReconciliation:mock.reverse}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),statement=crypto.randomUUID(),group=crypto.randomUUID();
const key=`finance-reconciliation-reversal:${tenant}:${actor}:${group}`;
function mount(reversed=false){return render(<ReconciliationReversal tenant={tenant} actor={actor} group={group} reversed={reversed} onRecorded={()=>{}}/>);}
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();mock.reverse.mockResolvedValue({confirmed:true});
 mock.history.mockResolvedValue({total:1,active_count:0,page:1,page_size:20,rows:[{id:group,tenant_id:tenant,bank_account_id:crypto.randomUUID(),direction:'out',amount_cents:'50000',method:'manual',actor_id:actor,actor_name:'Maria Financeiro',reason:'Conferência original do pagamento',account_evidence:'Agência e conta conferidas no original',created_at:'2026-09-09T12:00:00Z',evidence_issue:'source_changed',movement_count:1,bank_entry_count:1,movements:[],entries:[],reversal:{id:crypto.randomUUID(),actor_id:actor,actor_name:'João Gestor',reason:'Corrigida associação selecionada por engano',created_at:'2026-09-09T13:00:00Z'}}]});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function review(){fireEvent.click(screen.getByRole('button',{name:'Desfazer esta conciliação'}));fireEvent.change(screen.getByLabelText('Justificativa da reversão'),{target:{value:'Conciliação associada aos lançamentos incorretos'}});fireEvent.click(screen.getByRole('button',{name:'Revisar reversão'}));}
describe('reconciliation audit and reversal',()=>{
 it('preserves both actors, reasons and manual marking after reversal',async()=>{
  render(<QueryClientProvider client={new QueryClient()}><ReconciliationHistory tenant={tenant} actor={actor} statement={statement}/></QueryClientProvider>);
  expect(mock.history).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Histórico das conciliações'}));
  await screen.findByText('Conciliação manual · Revertida');expect(screen.getByText(/Maria Financeiro/)).toBeInTheDocument();expect(screen.getByText(/Revertida por João Gestor/)).toBeInTheDocument();
  expect(screen.getByText(/Conferência original do pagamento/)).toBeInTheDocument();expect(screen.getByText('Corrigida associação selecionada por engano')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Desfazer esta conciliação'})).not.toBeInTheDocument();
 });
 it('requires review and recovers a lost reply even if the refreshed history already shows reversed',async()=>{
  mock.reverse.mockRejectedValueOnce(new Error('lost reply'));const first=mount();await review();expect(mock.reverse).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Confirmar reversão da conciliação'}));await screen.findByText(/Retome a mesma reversão/);
  const command=JSON.parse(sessionStorage.getItem(key)!);first.unmount();mount(true);
  fireEvent.click(screen.getByRole('button',{name:'Retomar mesma reversão'}));await waitFor(()=>expect(sessionStorage.getItem(key)).toBeNull());
  expect(mock.reverse.mock.calls.map(([sent])=>sent)).toEqual([command,command]);
 });
 it('flags evidence contradicted after matching without hiding the original decision',async()=>{
  const data=await mock.history();mock.history.mockResolvedValue({...data,active_count:1,rows:[{...data.rows[0],reversal:null}]});
  render(<QueryClientProvider client={new QueryClient()}><ReconciliationHistory tenant={tenant} actor={actor} statement={statement}/></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Histórico das conciliações'}));await screen.findByText('Conciliação manual · Exige revisão das evidências');
  expect(screen.getByRole('alert')).toHaveTextContent('Uma nova conferência do original deixou de confirmar as linhas usadas');
  expect(screen.getByText(/Conferência original do pagamento/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Desfazer esta conciliação'})).toBeInTheDocument();
 });
 it('fails without sending when the recovery record cannot be written',async()=>{
  mount();await review();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  fireEvent.click(screen.getByRole('button',{name:'Confirmar reversão da conciliação'}));expect(await screen.findByText(/Nenhum envio foi iniciado/)).toBeInTheDocument();expect(mock.reverse).not.toHaveBeenCalled();
 });
 it('keeps an automatic decision identifiable when another import contests its reference',async()=>{
  const data=await mock.history();mock.history.mockResolvedValue({...data,active_count:1,rows:[{...data.rows[0],method:'automatic_reference',reversal:null,evidence_issue:'automatic_bank_reference_contested'}]});
  render(<QueryClientProvider client={new QueryClient()}><ReconciliationHistory tenant={tenant} actor={actor} statement={statement}/></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Histórico das conciliações'}));await screen.findByText('Conciliação automática por referência · Exige revisão das evidências');
  expect(screen.getByRole('alert')).toHaveTextContent('Outra importação contém linhas repetidas ou conflitantes');
  expect(screen.getByText(/Importação iniciada por Maria Financeiro/)).toBeInTheDocument();
 });
});
