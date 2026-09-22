import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const api=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:api.rpc}}));
import {PayableArchiveDialog} from '@/components/financial/PayableArchiveDialog';
const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),id=crypto.randomUUID();
beforeEach(()=>{localStorage.clear();api.rpc.mockReset();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,fn:()=>Promise<unknown>)=>fn()}});});
it('requires a reason and sends exactly the reviewed selected title and revision',async()=>{
 const done=vi.fn(),close=vi.fn();api.rpc.mockImplementation(async(_name:string,{_payload:c})=>({data:{version:1,tenant_id:tenant,request_id:c.request_id,payable_ids:[id],confirmed:true},error:null}));
 render(<PayableArchiveDialog tenant={tenant} actor={actor} titles={[{payable_id:id,revision:'a'.repeat(32),description:'Conta duplicada'}]} onClose={close} onRecorded={done}/>);
 fireEvent.click(screen.getByRole('button',{name:'Confirmar exclusão da lista'}));expect(api.rpc).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Motivo da exclusão'),{target:{value:'Título duplicado por engano'}});
 fireEvent.click(screen.getByRole('button',{name:'Confirmar exclusão da lista'}));
 await waitFor(()=>expect(done).toHaveBeenCalledOnce());expect(close).toHaveBeenCalledOnce();
 expect(api.rpc).toHaveBeenCalledWith('archive_finance_payables',{_payload:expect.objectContaining({items:[{payable_id:id,revision:'a'.repeat(32)}],reason:'Título duplicado por engano'})});
});
