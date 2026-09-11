import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {StatementIdentityReview} from '@/components/financial/StatementIdentityReview';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const mocks=vi.hoisted(()=>({review:vi.fn()}));
vi.mock('@/lib/financial/ledgerClient',async original=>({...await original<object>(),reviewFinanceStatementIdentity:mocks.review,readFinanceIdentityCandidates:vi.fn().mockResolvedValue({total:0,rows:[]})}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),verification=crypto.randomUUID();
const row={id:crypto.randomUUID(),tenant_id:tenant,import_id:crypto.randomUUID(),source_row:2,classification:'ambiguous' as const,
  bank_entry_id:null,candidate_count:0,posted_on:'2026-01-01',amount_cents:-50000,description:'PIX motorista',bank_id:null,
  document_number:null,counterparty_name:null,counterparty_document:null,source_cells:null,candidate_preview:[]};
const key=`finance-identity-review:${tenant}:${actor}:${row.id}`;
function mount(onRecorded=vi.fn()){return render(<QueryClientProvider client={new QueryClient()}><StatementIdentityReview tenant={tenant} actor={actor} row={row} verification={verification} onRecorded={onRecorded}/></QueryClientProvider>);}
function prepare(){fireEvent.click(screen.getByRole('button',{name:'Revisar identificação manualmente'}));fireEvent.change(screen.getByLabelText('Decisão'),{target:{value:'distinct_transaction'}});fireEvent.change(screen.getByLabelText('Justificativa'),{target:{value:'Transferência distinta conferida no banco'}});fireEvent.click(screen.getByRole('button',{name:'Revisar decisão antes de registrar'}));}
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();});
describe('manual statement identity decision recovery',()=>{
  it('requires a separate confirmation and preserves an identical request after an uncertain response',async()=>{
    mocks.review.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce({confirmed:true});
    const done=vi.fn(),first=mount(done);prepare();expect(mocks.review).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Confirmar decisão manual'}));
    await screen.findByRole('button',{name:'Retomar mesmo pedido'});await screen.findByRole('alert');
    const sent=mocks.review.mock.calls[0][0];expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(sent);
    expect(screen.queryByLabelText('Justificativa')).not.toBeInTheDocument();first.unmount();mount(done);
    fireEvent.click(screen.getByRole('button',{name:'Retomar mesmo pedido'}));
    await waitFor(()=>expect(done).toHaveBeenCalledOnce());expect(mocks.review.mock.calls[1][0]).toEqual(sent);expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('does not submit when durable local preservation fails',async()=>{
    mount();prepare();const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
    fireEvent.click(screen.getByRole('button',{name:'Confirmar decisão manual'}));expect(await screen.findByRole('alert')).toHaveTextContent('Nenhum envio foi iniciado');expect(mocks.review).not.toHaveBeenCalled();storage.mockRestore();
  });
  it('blocks a corrupt saved request instead of silently replacing it',()=>{
    sessionStorage.setItem(key,'broken');mount();expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível recuperar');
    expect(screen.getByRole('button',{name:'Revisar decisão antes de registrar'})).toBeDisabled();expect(mocks.review).not.toHaveBeenCalled();
  });
});
