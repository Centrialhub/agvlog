import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
const api=vi.hoisted(()=>({reverse:vi.fn()}));
vi.mock('@/lib/financial/ledgerClient',()=>({reversePayableLink:api.reverse,FinanceRejectedError:class extends Error{}}));
import {PayableLinkReversal} from '../components/financial/PayableLinkReversal';
const tenant='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000001',link='30000000-0000-4000-8000-000000000001';
const key=`finance-payable-reversal:${tenant}:${actor}:${link}`;
function mount(reversed=false,onRecorded=vi.fn()){return render(<PayableLinkReversal tenant={tenant} actor={actor} link={link} reversed={reversed} onRecorded={onRecorded}/>);}
function prepare(){fireEvent.click(screen.getByRole('button',{name:'Corrigir vínculo desta baixa'}));fireEvent.change(screen.getByLabelText('Motivo da correção'),{target:{value:'O título correto era de outro fornecedor'}});fireEvent.click(screen.getByRole('button',{name:'Revisar correção'}));}
beforeEach(()=>{vi.restoreAllMocks();sessionStorage.clear();api.reverse.mockReset();});
describe('audited payable link correction',()=>{
 it('requires explicit confirmation and describes that the money and history remain',async()=>{
  api.reverse.mockResolvedValue({});const recorded=vi.fn();mount(false,recorded);prepare();
  expect(api.reverse).not.toHaveBeenCalled();expect(screen.getByText(/não registra devolução bancária/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Confirmar desvinculação'}));
  await waitFor(()=>expect(recorded).toHaveBeenCalledTimes(1));
  expect(api.reverse.mock.calls[0][0]).toMatchObject({tenant_id:tenant,link_id:link,reason:'O título correto era de outro fornecedor'});
  expect(sessionStorage.getItem(key)).toBeNull();
 });
 it('resumes the same request even if refreshed history already reports the link reversed',async()=>{
  api.reverse.mockRejectedValueOnce(new Error('Resposta perdida'));const first=mount();prepare();
  fireEvent.click(screen.getByRole('button',{name:'Confirmar desvinculação'}));
  await screen.findByText('Não foi possível confirmar a resposta. Retome o mesmo pedido.');const original=api.reverse.mock.calls[0][0];
  first.unmount();api.reverse.mockResolvedValueOnce({});mount(true);
  fireEvent.click(screen.getByRole('button',{name:'Retomar mesma correção'}));
  await waitFor(()=>expect(api.reverse).toHaveBeenCalledTimes(2));expect(api.reverse.mock.calls[1][0]).toEqual(original);
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Retomar mesma correção'})).not.toBeInTheDocument());
 });
 it('blocks sending if it cannot preserve the request and blocks malformed recovery',()=>{
  const view=mount();prepare();const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
  fireEvent.click(screen.getByRole('button',{name:'Confirmar desvinculação'}));
  expect(api.reverse).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('Nenhum envio foi iniciado');
  spy.mockRestore();view.unmount();sessionStorage.setItem(key,'bad');mount();
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível recuperar');expect(screen.getByRole('button',{name:'Revisar correção'})).toBeDisabled();
 });
});
