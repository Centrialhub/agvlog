import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {InternalTransferDialog} from '@/components/financial/InternalTransferDialog';
const mock=vi.hoisted(()=>({record:vi.fn()}));
const tenant='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000001';
const source='40000000-0000-4000-8000-000000000001',destination='40000000-0000-4000-8000-000000000002';
vi.mock('@/hooks/useFinancialPayments',()=>({useBankAccounts:()=>({data:[{id:'40000000-0000-4000-8000-000000000001',name:'Banco origem',active:true},{id:'40000000-0000-4000-8000-000000000002',name:'Banco destino',active:true}],isPending:false,error:null})}));
vi.mock('@/lib/financial/ledgerClient',()=>({recordInternalTransfer:mock.record,FinanceRejectedError:class extends Error{}}));
beforeEach(()=>{sessionStorage.clear();vi.clearAllMocks();});afterEach(()=>{cleanup();vi.restoreAllMocks();});
function open(){return render(<InternalTransferDialog tenant={tenant} actor={actor} onClose={()=>{}} onRecorded={()=>{}}/>);}
function prepare(){
 fireEvent.change(screen.getByLabelText('Conta de saída'),{target:{value:source}});fireEvent.change(screen.getByLabelText('Conta de entrada'),{target:{value:destination}});
 for(const [label,value] of [['Valor transferido','500,00'],['Data da saída','2026-01-01'],['Data da entrada','2026-01-02'],['Motivo','Transferência entre nossas contas']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Revisar transferência'}));
}
it('reviews first and reuses exactly the same request after a lost response and remount',async()=>{
 mock.record.mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({});const view=open();prepare();expect(mock.record).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Confirmar registro dos dois lados'}));await screen.findByRole('alert');const command=mock.record.mock.calls[0][0];expect(command).toMatchObject({amount_cents:50000,source_account_id:source,destination_account_id:destination,both_recorded:true});
 view.unmount();open();fireEvent.click(screen.getByRole('button',{name:'Retomar mesmo registro'}));await waitFor(()=>expect(mock.record).toHaveBeenCalledTimes(2));expect(mock.record.mock.calls[1][0]).toEqual(command);
 await waitFor(()=>expect(sessionStorage.getItem(`finance-transfer:${tenant}:${actor}`)).toBeNull());
});
it('does not send when the recovery request cannot be saved',async()=>{
 open();prepare();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('storage unavailable');});fireEvent.click(screen.getByRole('button',{name:'Confirmar registro dos dois lados'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Nenhum registro foi enviado');expect(mock.record).not.toHaveBeenCalled();
});
