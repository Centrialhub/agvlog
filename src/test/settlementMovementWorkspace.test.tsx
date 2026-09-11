import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {SettlementMovementWorkspace} from '@/components/financial/SettlementMovementLink';
import {SettlementMovementRejectedError} from '@/lib/financial/settlementMovementClient';
const mock=vi.hoisted(()=>({read:vi.fn(),link:vi.fn(),reverse:vi.fn()}));
vi.mock('@/lib/financial/settlementMovementClient',()=>({readSettlementMovements:mock.read,linkSettlementMovement:mock.link,reverseSettlementMovement:mock.reverse,SettlementMovementRejectedError:class extends Error{}}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),payment=crypto.randomUUID(),settlement=crypto.randomUUID(),movement=crypto.randomUUID();
const options={version:1,tenant_id:tenant,payment_id:payment,settlement_id:settlement,amount_cents:10000,page:1,page_size:20,total:1,link:null,history:[],rows:[{id:movement,description:'Acerto de janeiro',occurred_on:'2026-01-01',amount_cents:50000,remaining_cents:20000,beneficiary_name:'Motorista QA',account_name:'Conta principal'}]};
beforeEach(()=>{sessionStorage.clear();vi.clearAllMocks();mock.read.mockResolvedValue(options);mock.link.mockResolvedValue({settlement_id:settlement});});afterEach(()=>{cleanup();vi.restoreAllMocks();});
function open(currentActor=actor){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SettlementMovementWorkspace tenant={tenant} actor={currentActor} payment={payment} settlement={settlement} onClose={()=>{}}/></QueryClientProvider>);}
async function fill(){fireEvent.click(await screen.findByRole('radio'));fireEvent.change(screen.getByLabelText('Justificativa'),{target:{value:'Conferido com pagamento existente'}});}
it('retains identical command after lost reply even when the linked movement disappears from candidates',async()=>{
 mock.link.mockRejectedValueOnce(new Error('Resposta perdida'));const view=open();await fill();fireEvent.click(screen.getByRole('button',{name:'Confirmar vínculo existente'}));await screen.findByRole('alert');
 const original=mock.link.mock.calls[0][0];expect(original).toMatchObject({payment_id:payment,movement_id:movement});expect(original).not.toHaveProperty('amount_cents');
 view.unmount();mock.read.mockResolvedValue({...options,total:0,rows:[],link:{id:crypto.randomUUID(),movement_id:movement,amount_cents:10000,created_by:actor,actor_name:'Financeiro QA',created_at:'2026-01-01T20:00:00Z',reason:original.reason}});
 open();fireEvent.click(screen.getByRole('button',{name:'Retomar pedido original'}));await waitFor(()=>expect(mock.link).toHaveBeenCalledTimes(2));expect(mock.link.mock.calls[1][0]).toEqual(original);expect(await screen.findByRole('status')).toHaveTextContent('Nenhum pagamento ou movimento adicional');
 expect(sessionStorage.getItem(`finance-settlement-link:${tenant}:${actor}:${payment}`)).toBeNull();
});
it('does not send without durable storage and does not reuse another actors pending command',async()=>{
 const view=open();await fill();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('full');});fireEvent.click(screen.getByRole('button',{name:'Confirmar vínculo existente'}));expect(await screen.findByRole('alert')).toHaveTextContent('Nenhum vínculo foi enviado');expect(mock.link).not.toHaveBeenCalled();
 vi.restoreAllMocks();mock.read.mockResolvedValue(options);sessionStorage.setItem(`finance-settlement-link:${tenant}:${actor}:${payment}`,JSON.stringify({actor,command:{version:1,tenant_id:tenant,request_id:crypto.randomUUID(),payment_id:payment,movement_id:movement,reason:'Pedido de outro ator'}}));view.unmount();open(crypto.randomUUID());await screen.findByRole('radio');expect(screen.queryByRole('button',{name:'Retomar pedido original'})).not.toBeInTheDocument();
});
it('shows who linked the payment and leaves reconciliation explicitly separate',async()=>{
 mock.read.mockResolvedValue({...options,total:0,rows:[],link:{id:crypto.randomUUID(),movement_id:movement,amount_cents:10000,created_by:actor,actor_name:'Ana Financeiro',created_at:'2026-01-01T20:00:00Z',reason:'Conferência do acerto'}});open();expect(await screen.findByText(/Por Ana Financeiro/)).toBeInTheDocument();expect(screen.getByText(/conferência com o extrato continua separada/)).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Confirmar vínculo existente'})).not.toBeInTheDocument();
});
it('unlocks the selection after a known first-attempt rejection, but preserves previously uncertain requests',async()=>{
 mock.link.mockRejectedValueOnce(new SettlementMovementRejectedError('finance_movement_overallocated'));
 const view=open();await fill();fireEvent.click(screen.getByRole('button',{name:'Confirmar vínculo existente'}));expect(await screen.findByRole('alert')).toHaveTextContent('Vínculo recusado');expect(sessionStorage.getItem(`finance-settlement-link:${tenant}:${actor}:${payment}`)).toBeNull();expect(screen.getByRole('radio')).not.toBeChecked();
 mock.link.mockRejectedValueOnce(new Error('Lost reply'));await fill();fireEvent.click(screen.getByRole('button',{name:'Confirmar vínculo existente'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('pedido original foi preservado'));const original=mock.link.mock.calls[1][0];
 view.unmount();mock.link.mockRejectedValueOnce(new SettlementMovementRejectedError('finance_access_denied'));open();fireEvent.click(screen.getByRole('button',{name:'Retomar pedido original'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Acesso financeiro não permitido'));expect(JSON.parse(sessionStorage.getItem(`finance-settlement-link:${tenant}:${actor}:${payment}`)!).command).toEqual(original);
});
it('hides cached capacity after a failed refresh',async()=>{
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={cache}><SettlementMovementWorkspace tenant={tenant} actor={actor} payment={payment} settlement={settlement} onClose={()=>{}}/></QueryClientProvider>);
 await screen.findByRole('radio');mock.read.mockRejectedValue(new Error('Consulta indisponível'));
 await act(async()=>{await cache.invalidateQueries({queryKey:['finance-settlement-movements']});});
 expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar o vínculo');expect(screen.queryByRole('radio')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Confirmar vínculo existente'})).not.toBeInTheDocument();
});
it('keeps the manual link and correction authors visible after reversal',async()=>{
 mock.read.mockResolvedValue({...options,history:[{id:crypto.randomUUID(),movement_id:movement,amount_cents:10000,created_by:actor,actor_name:'Ana Financeiro',created_at:'2026-01-01T20:00:00Z',reason:'Conferência original',reversal:{id:crypto.randomUUID(),actor_id:crypto.randomUUID(),actor_name:'Gestor Paulo',created_at:'2026-01-02T20:00:00Z',reason:'Saída errada identificada'}}]});
 open();expect(await screen.findByText(/Vínculo manual · Desfeito/)).toBeInTheDocument();expect(screen.getByText(/Vinculado por Ana Financeiro/)).toBeInTheDocument();expect(screen.getByText(/Desfeito por Gestor Paulo/)).toBeInTheDocument();expect(screen.getByText('Motivo da correção: Saída errada identificada')).toBeInTheDocument();
});
