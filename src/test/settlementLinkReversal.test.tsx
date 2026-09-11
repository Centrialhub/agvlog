import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {SettlementLinkReversal} from '@/components/financial/SettlementLinkReversal';
import {SettlementMovementRejectedError} from '@/lib/financial/settlementMovementClient';
const mock=vi.hoisted(()=>({reverse:vi.fn()}));vi.mock('@/lib/financial/settlementMovementClient',()=>({reverseSettlementMovement:mock.reverse,SettlementMovementRejectedError:class extends Error{}}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),payment=crypto.randomUUID(),link=crypto.randomUUID(),pending=vi.fn();
const key=`finance-settlement-reversal:${tenant}:${actor}:${payment}`;
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();mock.reverse.mockResolvedValue({});});afterEach(()=>{cleanup();vi.restoreAllMocks();});
function open(activeLink:string|null=link){return render(<QueryClientProvider client={new QueryClient()}><SettlementLinkReversal tenant={tenant} actor={actor} payment={payment} activeLink={activeLink} disabled={false} onPendingChange={pending} onConfirmed={()=>{}}/></QueryClientProvider>);}
function fill(){fireEvent.click(screen.getByRole('button',{name:'Corrigir vínculo incorreto'}));fireEvent.change(screen.getByLabelText('Motivo da correção'),{target:{value:'Saída incorreta identificada na conferência'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar correção do vínculo'}));}
it('replays the original correction after its link is no longer active',async()=>{
 mock.reverse.mockRejectedValueOnce(new Error('Resposta perdida'));const view=open();fill();await screen.findByRole('alert');const command=mock.reverse.mock.calls[0][0];expect(command).toMatchObject({link_id:link});expect(command).not.toHaveProperty('amount_cents');expect(pending).toHaveBeenCalledWith(true);
 view.unmount();open(null);fireEvent.click(screen.getByRole('button',{name:'Retomar correção original'}));await screen.findByRole('status');expect(mock.reverse.mock.calls[1][0]).toEqual(command);expect(sessionStorage.getItem(key)).toBeNull();expect(screen.getByRole('status')).toHaveTextContent('pagamento e o dinheiro permanecem');
});
it('does not submit when local recovery storage fails',async()=>{
 open();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('full');});fill();expect(await screen.findByRole('alert')).toHaveTextContent('Nenhum pedido foi enviado');expect(mock.reverse).not.toHaveBeenCalled();
});
it('unlocks a known initial rejection while preserving an uncertain restored correction',async()=>{
 mock.reverse.mockRejectedValueOnce(new SettlementMovementRejectedError('finance_access_denied'));const view=open();fill();expect(await screen.findByRole('alert')).toHaveTextContent('Correção recusada');expect(sessionStorage.getItem(key)).toBeNull();
 view.unmount();const command={version:1,tenant_id:tenant,request_id:crypto.randomUUID(),link_id:link,reason:'Correção já tentada anteriormente'};sessionStorage.setItem(key,JSON.stringify({actor,payment,command}));mock.reverse.mockRejectedValueOnce(new SettlementMovementRejectedError('finance_access_denied'));open(null);fireEvent.click(screen.getByRole('button',{name:'Retomar correção original'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('preservada para retomada'));expect(JSON.parse(sessionStorage.getItem(key)!).command).toEqual(command);
});
