import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { ExpenseBatchDialog } from '@/components/financial/ExpenseBatchDialog';
import { FinanceRejectedError } from '@/lib/financial/ledgerClient';
import { newExpenseLine,type ExpenseBatchDraft } from '@/lib/financial/expenseBatchContract';
const mocks=vi.hoisted(()=>({record:vi.fn()}));
vi.mock('@/lib/financial/ledgerClient',async original=>({...await original<object>(),recordExpenseBatch:mocks.record}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID();
const key=`finance-expense-batch:${tenant}:${actor}`;
function seed() {
  const draft:ExpenseBatchDraft={context:'office',trip:null,description:'Compras sede',reason:'Conferência das compras',
    lines:[{...newExpenseLine('office'),description:'Material de limpeza',amount:'150,00',supplierName:'Loja QA',noReceiptReason:'Comprovante solicitado ao estabelecimento'}]};
  sessionStorage.setItem(key,JSON.stringify({draft,request:null}));
}
function mount(done=vi.fn()) {
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
    <ExpenseBatchDialog tenant={tenant} actor={actor} onClose={vi.fn()} onRecorded={done}/>
  </QueryClientProvider>);
}
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();seed();});
describe('batch review and safe recovery',()=>{
  it('requires review then freezes and reuses the entire command after an uncertain response',async()=>{
    mocks.record.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({confirmed:true});
    const done=vi.fn();const first=mount(done);
    fireEvent.click(screen.getByRole('button',{name:'Revisar lote'}));expect(mocks.record).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Registrar lote conferido'}));
    await screen.findByRole('alert');expect(screen.getByLabelText('Valor 1')).toBeDisabled();
    first.unmount();mount(done);
    expect(screen.getByLabelText('Valor 1')).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Reenviar mesmo lote'}));
    await waitFor(()=>expect(done).toHaveBeenCalledOnce());
    expect(mocks.record.mock.calls[0][0]).toEqual(mocks.record.mock.calls[1][0]);
    expect(mocks.record.mock.calls[0][0].items[0]).toMatchObject({amount_cents:15000,category:'office',payee_type:'supplier',allocations:[]});
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('preserves editable data after a definitive rejection',async()=>{
    mocks.record.mockRejectedValue(new FinanceRejectedError('finance_movement_overallocated'));
    mount();fireEvent.click(screen.getByRole('button',{name:'Revisar lote'}));fireEvent.click(screen.getByRole('button',{name:'Registrar lote conferido'}));
    await screen.findByRole('alert');expect(screen.getByLabelText('Valor 1')).toBeEnabled();
    expect(screen.getByLabelText('Valor 1')).toHaveValue('150,00');
    expect(JSON.parse(sessionStorage.getItem(key)!).request).toBeNull();
  });
  it('keeps a previously uncertain request frozen after a subsequent database rejection',async()=>{
    mocks.record.mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new FinanceRejectedError('finance_movement_overallocated'));
    const first=mount();fireEvent.click(screen.getByRole('button',{name:'Revisar lote'}));fireEvent.click(screen.getByRole('button',{name:'Registrar lote conferido'}));
    await screen.findByRole('alert');const original=sessionStorage.getItem(key);first.unmount();mount();
    fireEvent.click(screen.getByRole('button',{name:'Reenviar mesmo lote'}));await screen.findByRole('alert');
    expect(screen.getByLabelText('Valor 1')).toBeDisabled();expect(sessionStorage.getItem(key)).toBe(original);
    expect(mocks.record.mock.calls[1][0]).toEqual(mocks.record.mock.calls[0][0]);
  });
  it.each(['{broken',JSON.stringify({request:crypto.randomUUID(),draft:{}})])('does not overwrite unreadable recovery data or allow a new request',async(raw)=>{
    sessionStorage.setItem(key,raw);mount();expect(await screen.findByRole('alert')).toHaveTextContent('O conteúdo original foi mantido');
    expect(screen.getByRole('button',{name:'Revisar lote'})).toBeDisabled();expect(screen.getByLabelText('Valor 1')).toBeDisabled();
    expect(sessionStorage.getItem(key)).toBe(raw);expect(mocks.record).not.toHaveBeenCalled();
  });
});
