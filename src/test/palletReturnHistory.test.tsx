import {render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';

vi.mock('@/hooks/usePalletReturns',()=>({usePalletHistory:()=>({isLoading:false,isError:false,isSuccess:true,data:[
  {id:'one',action:'created',created_at:'2026-09-20T12:00:00Z',created_by:'autor-1',field_name:null,old_value:null,new_value:'PR-1',reason:null,metadata:{status:'draft'}},
  {id:'two',action:'edited',created_at:'2026-09-21T12:00:00Z',created_by:'autor-2',field_name:null,old_value:null,new_value:null,reason:'Correção conferida',metadata:{patch:{issue_date:'2026-09-21'}}},
  {id:'three',action:'cancelled',created_at:'2026-09-22T12:00:00Z',created_by:'autor-3',field_name:'status',old_value:'draft',new_value:'cancelled',reason:'Duplicado',metadata:{}},
]})}));
import {PalletReturnHistory} from '@/components/palletReturns/PalletReturnHistory';

it('shows protocol creation, edits, cancellation, reason and author',()=>{
  render(<PalletReturnHistory protocolId="protocol-1"/>);
  expect(screen.getByRole('region',{name:'Histórico do protocolo'})).toBeInTheDocument();
  expect(screen.getByText(/Criação/)).toBeInTheDocument();
  expect(screen.getByText(/Edição/)).toBeInTheDocument();
  expect(screen.getByText(/Cancelamento/)).toBeInTheDocument();
  expect(screen.getByText(/Motivo: Correção conferida/)).toBeInTheDocument();
  expect(screen.getByText(/Motivo: Duplicado/)).toBeInTheDocument();
  expect(screen.getByText(/Autor: autor-3/)).toBeInTheDocument();
  expect(screen.getByText(/De draft para cancelled/)).toBeInTheDocument();
});
