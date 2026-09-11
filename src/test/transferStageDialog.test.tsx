import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {TransferStageDialog} from '@/components/financial/TransferStageDialog';
import type {PendingTransfer} from '@/lib/financial/transferStageContract';
const mock=vi.hoisted(()=>({record:vi.fn()}));
const tenant='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000001',source='40000000-0000-4000-8000-000000000001',destination='40000000-0000-4000-8000-000000000002';
vi.mock('@/hooks/useFinancialPayments',()=>({useBankAccounts:()=>({data:[{id:'40000000-0000-4000-8000-000000000001',name:'Origem',active:true},{id:'40000000-0000-4000-8000-000000000002',name:'Destino',active:true}],isPending:false,error:null})}));
vi.mock('@/lib/financial/ledgerClient',()=>({recordTransferStage:mock.record,FinanceRejectedError:class extends Error{}}));
const departure:PendingTransfer={id:crypto.randomUUID(),outgoing_id:crypto.randomUUID(),amount_cents:50000,occurred_on:'2026-01-01',source_account_id:source,destination_account_id:destination,source_name:'Origem',destination_name:'Destino',bank_reference:null,created_by:actor,created_at:'2026-01-01T12:00:00Z'};
beforeEach(()=>{sessionStorage.clear();vi.clearAllMocks();});afterEach(()=>{cleanup();vi.restoreAllMocks();});
function open(mode:'depart'|'arrive'|'recover'){return render(<TransferStageDialog tenant={tenant} actor={actor} mode={mode} departure={mode==='arrive'?departure:undefined} onClose={()=>{}} onRecorded={()=>{}}/>);}
function fill(mode:'depart'|'arrive'){
 if(mode==='depart'){fireEvent.change(screen.getByLabelText('Conta de saída'),{target:{value:source}});fireEvent.change(screen.getByLabelText('Conta de destino esperado'),{target:{value:destination}});fireEvent.change(screen.getByLabelText('Valor da saída'),{target:{value:'500,00'}});}
 fireEvent.change(screen.getByLabelText(mode==='depart'?'Data da saída':'Data da chegada'),{target:{value:'2026-01-02'}});fireEvent.change(screen.getByLabelText('Motivo'),{target:{value:'Registro confirmado pelo financeiro'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Revisar etapa'}));
}
it('reviews and records only departure without an anticipated destination credit',async()=>{
 mock.record.mockResolvedValue({});open('depart');fill('depart');expect(mock.record).not.toHaveBeenCalled();expect(screen.getByText(/Nenhum crédito será antecipado/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Confirmar registro da etapa'}));await waitFor(()=>expect(mock.record).toHaveBeenCalledTimes(1));expect(mock.record.mock.calls[0][0]).toMatchObject({stage:'depart',amount_cents:50000,source_account_id:source,destination_account_id:destination});
});
it('recovers the original arrival without a pending row and without user-supplied amount or destination',async()=>{
 mock.record.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({});const view=open('arrive');fill('arrive');fireEvent.click(screen.getByRole('button',{name:'Confirmar registro da etapa'}));await screen.findByRole('alert');const command=mock.record.mock.calls[0][0];
 expect(command).toMatchObject({stage:'arrive',departure_id:departure.id});expect(command).not.toHaveProperty('amount_cents');expect(command).not.toHaveProperty('destination_account_id');view.unmount();open('recover');
 fireEvent.click(screen.getByRole('button',{name:'Retomar mesma etapa'}));await waitFor(()=>expect(mock.record).toHaveBeenCalledTimes(2));expect(mock.record.mock.calls[1][0]).toEqual(command);
});
it('blocks sending when recovery storage is unavailable',async()=>{
 open('depart');fill('depart');vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('full');});fireEvent.click(screen.getByRole('button',{name:'Confirmar registro da etapa'}));expect(await screen.findByRole('alert')).toHaveTextContent('Nenhum registro foi enviado');expect(mock.record).not.toHaveBeenCalled();
});
