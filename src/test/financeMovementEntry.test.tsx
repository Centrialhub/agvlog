import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MovementEntryDialog } from '@/components/financial/MovementEntryDialog';
import { FinanceRejectedError } from '@/lib/financial/ledgerClient';

const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('@/hooks/useFinancialPayments', () => ({ useBankAccounts: () => ({ data: [{ id: 'bank', name: 'Banco empresa' }] }) }));
vi.mock('@/hooks/useDrivers', () => ({ useDrivers: () => ({ data: [{ id: 'driver', name: 'Motorista João' }] }) }));
vi.mock('@/lib/financial/ledgerClient', async importOriginal => ({ ...await importOriginal<object>(), recordFinanceMovement: mocks.record }));
const tenant = '10000000-0000-4000-8000-000000000001', actor = '20000000-0000-4000-8000-000000000001';
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });
function fill() {
  fireEvent.change(screen.getByLabelText('Conta'), { target: { value: 'bank' } });
  fireEvent.change(screen.getByLabelText('Motorista beneficiário'), { target: { value: 'driver' } });
  fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '500,00' } });
  fireEvent.change(screen.getByLabelText('Motivo da movimentação'), { target: { value: 'Despesas da viagem' } });
  fireEvent.change(screen.getByLabelText('Observação da conferência'), { target: { value: 'PIX conferido no banco' } });
}
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
  it.each(['{broken',JSON.stringify({form:{amount:'500,00'},request:crypto.randomUUID()})])('preserves corrupt recovery data and prevents a new command (%s)',raw=>{
    const key=`finance-movement-draft:${tenant}:${actor}`;sessionStorage.setItem(key,raw);
    render(<MovementEntryDialog tenant={tenant} actor={actor} onClose={vi.fn()} onRecorded={vi.fn()}/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Novos envios estão bloqueados');
    expect(screen.getByRole('button',{name:'Registrar movimentação'})).toBeDisabled();
    expect(sessionStorage.getItem(key)).toBe(raw);expect(mocks.record).not.toHaveBeenCalled();
  });
});
