import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {StatementReviewReversal} from '@/components/financial/StatementReviewReversal';
import {FinanceRejectedError} from '@/lib/financial/ledgerClient';
const mocks=vi.hoisted(()=>({reverse:vi.fn()}));
vi.mock('@/lib/financial/ledgerClient',async original=>({...await original<object>(),reverseFinanceIdentityReview:mocks.reverse}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),reviewId=crypto.randomUUID(),key=`finance-review-reversal:${tenant}:${actor}:${reviewId}`;
function mount(done=vi.fn()){return render(<StatementReviewReversal tenant={tenant} actor={actor} reviewId={reviewId} onRecorded={done}/>);}
function prepare(){fireEvent.click(screen.getByRole('button',{name:'Reverter esta decisão'}));fireEvent.change(screen.getByLabelText('Motivo da reversão'),{target:{value:'Correspondência incorreta após nova conferência'}});fireEvent.click(screen.getByRole('button',{name:'Revisar reversão antes de registrar'}));}
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();});
describe('manual review reversal confirmation and recovery',()=>{
  it('preserves the same reversal through an uncertain reply and page remount',async()=>{
    mocks.reverse.mockRejectedValueOnce(new Error('lost reply')).mockResolvedValueOnce({confirmed:true});const done=vi.fn(),first=mount(done);
    prepare();expect(mocks.reverse).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirmar reversão'}));await screen.findByRole('alert');
    const command=mocks.reverse.mock.calls[0][0];expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(command);first.unmount();mount(done);
    fireEvent.click(screen.getByRole('button',{name:'Retomar mesma reversão'}));await waitFor(()=>expect(done).toHaveBeenCalledOnce());
    expect(mocks.reverse.mock.calls[1][0]).toEqual(command);expect(sessionStorage.getItem(key)).toBeNull();
  });
  it('retains an uncertain request even when a later attempt is denied',async()=>{
    mocks.reverse.mockRejectedValueOnce(new Error('timeout')).mockRejectedValueOnce(new FinanceRejectedError('finance_access_denied'));
    mount();prepare();fireEvent.click(screen.getByRole('button',{name:'Confirmar reversão'}));await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button',{name:'Retomar mesma reversão'}));await screen.findByText('Acesso financeiro não permitido.');
    expect(screen.queryByLabelText('Motivo da reversão')).not.toBeInTheDocument();expect(sessionStorage.getItem(key)).not.toBeNull();
  });
  it('explains dependency rejection and permits editing only when the initial request was rejected',async()=>{
    mocks.reverse.mockRejectedValueOnce(new FinanceRejectedError('finance_identity_review_has_dependents'));
    mount();prepare();fireEvent.click(screen.getByRole('button',{name:'Confirmar reversão'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Outras revisões utilizam esta transação');
    expect(screen.getByLabelText('Motivo da reversão')).toBeInTheDocument();expect(sessionStorage.getItem(key)).toBeNull();
  });
});
