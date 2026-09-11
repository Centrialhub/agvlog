import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {DriverExpenseForm} from '@/components/driver/DriverExpenseForm';

const submit=vi.hoisted(()=>vi.fn());
vi.mock('@/hooks/useOnlineStatus',()=>({useOnlineStatus:()=>false}));
vi.mock('@/hooks/useDriverExpensesOperational',()=>({
 useOperationalDriverExpenseContext:()=>({isPending:false,error:null,data:{offline:true,context:{can_create:true,revision:'a'.repeat(32)}}}),
 useDriverExpenseSubmission:()=>({submit:{isPending:false,mutateAsync:submit}}),
}));

describe('DriverExpenseForm',()=>{
 beforeEach(()=>{submit.mockReset();submit.mockResolvedValue({queued:true,requestId:'de100000-0000-4000-8000-000000000003',needsAttention:false,message:'Despesa salva no aparelho.'});});
 it('requires evidence and submits a trip-scoped pending command for durable synchronization',async()=>{
  const saved=vi.fn(),file=new File([new Uint8Array(8)],'cupom.png',{type:'image/png'});render(<DriverExpenseForm sourceId="de100000-0000-4000-8000-000000000004" onSaved={saved}/>);
  expect(screen.getByRole('button',{name:'Salvar para sincronizar'})).toBeEnabled();fireEvent.change(screen.getByLabelText('Valor (R$)'),{target:{value:'42,75'}});fireEvent.change(screen.getByLabelText('Comprovante obrigatório'),{target:{files:[file]}});
  fireEvent.submit(screen.getByRole('button',{name:'Salvar para sincronizar'}).closest('form')!);await waitFor(()=>expect(submit).toHaveBeenCalledTimes(1));
  expect(submit.mock.calls[0][0]).toMatchObject({file,input:{source_type:'trip',source_id:'de100000-0000-4000-8000-000000000004',expected_revision:'a'.repeat(32),receipt:null,fields:{amount_cents:4275,no_receipt:false,no_receipt_reason:null}}});
  expect(saved).toHaveBeenCalledWith('Despesa salva no aparelho.');expect(screen.getByText('Despesa salva no aparelho.')).toBeInTheDocument();
 });
 it('does not create a request without a receipt',async()=>{
  render(<DriverExpenseForm sourceId="de100000-0000-4000-8000-000000000004" onSaved={vi.fn()}/>);fireEvent.change(screen.getByLabelText('Valor (R$)'),{target:{value:'10'}});fireEvent.submit(screen.getByRole('button',{name:'Salvar para sincronizar'}).closest('form')!);
  await screen.findByText('Fotografe ou selecione o comprovante da despesa.');expect(submit).not.toHaveBeenCalled();
 });
});
