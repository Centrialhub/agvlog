import { fireEvent, render as renderView, screen, waitFor } from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {ReactElement} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MovementEntryDialog } from '@/components/financial/MovementEntryDialog';
import { FinanceRejectedError } from '@/lib/financial/ledgerClient';

const mocks = vi.hoisted(() => ({ record: vi.fn(), options:vi.fn() }));
vi.mock('@/hooks/useFinancialPayments', () => ({ useBankAccounts: () => ({ data: [{ id: 'bank', name: 'Banco empresa',active:true},{id:'other-bank',name:'Banco secundário',active:true},{id:'inactive-bank',name:'Banco encerrado',active:false}] }) }));
vi.mock('@/hooks/useDrivers', () => ({ useDrivers: () => ({ data: [{ id: 'driver', name: 'Motorista João' }] }) }));
vi.mock('@/lib/financial/ledgerClient', async importOriginal => ({ ...await importOriginal<object>(), recordFinanceMovement: mocks.record,readExpenseOptions:mocks.options }));
const tenant = '10000000-0000-4000-8000-000000000001', actor = '20000000-0000-4000-8000-000000000001';
const center='50000000-0000-4000-8000-000000000001';
function render(ui:ReactElement){return renderView(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{ui}</QueryClientProvider>);}
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); mocks.options.mockResolvedValue({total:1,rows:[{id:center,label:'Manutenção da frota'}]}); });
function fill() {
  fireEvent.change(screen.getByLabelText('Conta'), { target: { value: 'bank' } });
  fireEvent.change(screen.getByLabelText('Motorista beneficiário'), { target: { value: 'driver' } });
  fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '500,00' } });
  fireEvent.change(screen.getByLabelText('Motivo da movimentação'), { target: { value: 'Despesas da viagem' } });
  fireEvent.change(screen.getByLabelText('Observação da conferência'), { target: { value: 'PIX conferido no banco' } });
}
async function selectCenter(){
 fireEvent.click(screen.getByRole('button',{name:'Centro de custo: Selecionar'}));
 fireEvent.click(await screen.findByRole('button',{name:'Manutenção da frota'}));
}
it('keeps the selected cost center in the draft and in an uncertain request after reopening',async()=>{
 mocks.record.mockRejectedValueOnce(new Error('Resposta perdida')).mockResolvedValueOnce({confirmed:true});
 const first=render(<MovementEntryDialog tenant={tenant} actor={actor} onClose={vi.fn()} onRecorded={vi.fn()}/>);
 fill();await selectCenter();expect(mocks.options).toHaveBeenCalledWith(tenant,'centers','',null,1);
 first.unmount();const done=vi.fn();
 render(<MovementEntryDialog tenant={tenant} actor={actor} onClose={vi.fn()} onRecorded={done}/>);
 expect(screen.getByRole('button',{name:'Centro de custo: Manutenção da frota'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'Registrar movimentação'}));await screen.findByRole('alert');
 expect(screen.getByRole('button',{name:'Centro de custo: Manutenção da frota'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Reenviar mesmo pedido'}));await waitFor(()=>expect(done).toHaveBeenCalledOnce());
 expect(mocks.record.mock.calls[0][0]).toMatchObject({cost_center_id:center});expect(mocks.record.mock.calls[1][0]).toEqual(mocks.record.mock.calls[0][0]);
});
it('shows catalog errors and allows retrying the cost center search',async()=>{
 mocks.options.mockRejectedValueOnce(new Error('offline'));
 render(<MovementEntryDialog tenant={tenant} actor={actor} onClose={vi.fn()} onRecorded={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'Centro de custo: Selecionar'}));
 fireEvent.click(await screen.findByRole('button',{name:'Tentar novamente'}));
 expect(await screen.findByRole('button',{name:'Manutenção da frota'})).toBeEnabled();
});
it('replays a saved legacy request without adding a cost center to its payload',async()=>{
 const key=`finance-movement-draft:${tenant}:${actor}`,request=crypto.randomUUID();
 sessionStorage.setItem(key,JSON.stringify({request,form:{account:'bank',driver:'driver',amount:'500,00',date:'2026-01-01',description:'Despesa conferida',beneficiary:'Motorista João',reference:'',reason:'Registro anterior',nature:'driver_advance',direction:'out'}}));
 mocks.record.mockResolvedValueOnce({confirmed:true});const done=vi.fn();
 render(<MovementEntryDialog tenant={tenant} actor={actor} onClose={vi.fn()} onRecorded={done}/>);
 fireEvent.click(screen.getByRole('button',{name:'Reenviar mesmo pedido'}));await waitFor(()=>expect(done).toHaveBeenCalledOnce());
 expect(mocks.record.mock.calls[0][0]).toMatchObject({request_id:request});expect(mocks.record.mock.calls[0][0]).not.toHaveProperty('cost_center_id');
});
describe('movement entry recovery', () => {
  it('keeps the exact request frozen after an uncertain reply and retries without generating a second ID', async () => {
    mocks.record.mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce({ confirmed: true });
    const done = vi.fn(); render(<MovementEntryDialog tenant={tenant} actor={actor} onClose={vi.fn()} onRecorded={done} />);
    fill(); fireEvent.click(screen.getByRole('button', { name: 'Registrar movimentação' }));
    await screen.findByRole('alert'); expect(screen.getByLabelText('Valor (R$)')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar mesmo pedido' }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(mocks.record.mock.calls[0][0]).toEqual(mocks.record.mock.calls[1][0]);
    expect(mocks.record.mock.calls[0][0]).toMatchObject({ amount_cents: 50000, beneficiary_name: 'Motorista João', driver_id: 'driver' });
  });
  it('lets the operator correct a database-rejected request without losing the draft', async () => {
    mocks.record.mockRejectedValue(new FinanceRejectedError('finance_invalid_account'));
    render(<MovementEntryDialog tenant={tenant} actor={actor} onClose={vi.fn()} onRecorded={vi.fn()} />);
    fill(); fireEvent.click(screen.getByRole('button', { name: 'Registrar movimentação' }));
    await screen.findByText('Selecione uma conta ativa desta empresa.');
    expect(screen.getByLabelText('Valor (R$)')).toBeEnabled(); expect(screen.getByLabelText('Valor (R$)')).toHaveValue('500,00');
  });
  it('restores a draft after closing and reopening in the same scoped session', () => {
    const first = render(<MovementEntryDialog tenant={tenant} actor={actor} onClose={vi.fn()} onRecorded={vi.fn()} />);
    fill(); first.unmount(); render(<MovementEntryDialog tenant={tenant} actor={actor} onClose={vi.fn()} onRecorded={vi.fn()} />);
    expect(screen.getByLabelText('Valor (R$)')).toHaveValue('500,00');
    expect(screen.getByLabelText('Beneficiário / pagador')).toHaveValue('Motorista João');
  });
  it('keeps the original command after remount and a later rejection of an uncertain request',async()=>{
    mocks.record.mockRejectedValueOnce(new Error('lost reply')).mockRejectedValueOnce(new FinanceRejectedError('finance_invalid_account')).mockResolvedValueOnce({confirmed:true});
    const first=render(<MovementEntryDialog tenant={tenant} actor={actor} onClose={vi.fn()} onRecorded={vi.fn()}/>);
    fill();fireEvent.click(screen.getByRole('button',{name:'Registrar movimentação'}));await screen.findByRole('alert');first.unmount();
    const done=vi.fn();render(<MovementEntryDialog tenant={tenant} actor={actor} onClose={vi.fn()} onRecorded={done}/>);
    fireEvent.click(screen.getByRole('button',{name:'Reenviar mesmo pedido'}));await screen.findByText('Selecione uma conta ativa desta empresa.');
    expect(screen.getByLabelText('Valor (R$)')).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Reenviar mesmo pedido'}));await waitFor(()=>expect(done).toHaveBeenCalledOnce());
    expect(mocks.record.mock.calls[1][0]).toEqual(mocks.record.mock.calls[0][0]);expect(mocks.record.mock.calls[2][0]).toEqual(mocks.record.mock.calls[0][0]);
  });
  it.each(['{broken',JSON.stringify({form:{amount:'500,00'},request:crypto.randomUUID()})])('discards corrupt recovery data and enables a clean command (%s)',raw=>{
    const key=`finance-movement-draft:${tenant}:${actor}`;sessionStorage.setItem(key,raw);
    render(<MovementEntryDialog tenant={tenant} actor={actor} onClose={vi.fn()} onRecorded={vi.fn()}/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Novos envios estão bloqueados');
    expect(screen.getByRole('button',{name:'Registrar movimentação'})).toBeDisabled();
    expect(sessionStorage.getItem(key)).toBe(raw);fireEvent.click(screen.getByRole('button',{name:'Descartar recuperação incompatível'}));
    expect(screen.queryByText(/Novos envios estão bloqueados/)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Registrar movimentação'})).toBeEnabled();expect(sessionStorage.getItem(key)).not.toBe(raw);expect(mocks.record).not.toHaveBeenCalled();
  });
});

it('defaults a fresh send to the selected driver without replacing a restored draft',()=>{
 const first=render(<MovementEntryDialog tenant={tenant} actor={actor} initialDriver={{id:'driver',name:'Motorista João'}} onClose={vi.fn()} onRecorded={vi.fn()}/>);
 expect(screen.getByLabelText('Motorista beneficiário')).toHaveValue('driver');expect(screen.getByLabelText('Beneficiário / pagador')).toHaveValue('Motorista João');fill();first.unmount();
 render(<MovementEntryDialog tenant={tenant} actor={actor} initialDriver={{id:'another',name:'Outro motorista'}} onClose={vi.fn()} onRecorded={vi.fn()}/>);
 expect(screen.getByLabelText('Motorista beneficiário')).toHaveValue('driver');expect(screen.getByLabelText('Beneficiário / pagador')).toHaveValue('Motorista João');expect(screen.getByLabelText('Valor (R$)')).toHaveValue('500,00');
});

it('offers only active accounts for a new movement',()=>{render(<MovementEntryDialog tenant={tenant} actor={actor} onClose={vi.fn()} onRecorded={vi.fn()}/>);expect(screen.getByRole('option',{name:'Banco empresa'})).toBeInTheDocument();expect(screen.queryByRole('option',{name:'Banco encerrado'})).not.toBeInTheDocument();});

it('requires an explicit account choice when a restored draft belongs to another account',()=>{const key=`finance-movement-draft:${tenant}:${actor}`;sessionStorage.setItem(key,JSON.stringify({request:null,form:{account:'other-bank',driver:'driver',amount:'500,00',date:'2026-01-01',description:'Despesa conferida',beneficiary:'Motorista João',reference:'',reason:'Registro anterior',nature:'driver_advance',direction:'out'}}));render(<MovementEntryDialog tenant={tenant} actor={actor} initialAccount="bank" onClose={vi.fn()} onRecorded={vi.fn()}/>);expect(screen.getByRole('alert')).toHaveTextContent('rascunho recuperado pertence a outra conta');expect(screen.getByRole('button',{name:'Registrar movimentação'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Usar conta atualmente selecionada'}));expect(screen.getByLabelText('Conta')).toHaveValue('bank');expect(screen.queryByText(/rascunho recuperado pertence a outra conta/)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Registrar movimentação'})).toBeEnabled();expect(mocks.record).not.toHaveBeenCalled();});
