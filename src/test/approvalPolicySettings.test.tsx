import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ApprovalPolicySettings} from '@/components/financial/ApprovalPolicySettings';
const mock=vi.hoisted(()=>({rpc:vi.fn(),fail:false}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
const tenant=crypto.randomUUID(),actor=crypto.randomUUID();
beforeEach(()=>{localStorage.clear();mock.rpc.mockReset();mock.fail=false;Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,work:()=>Promise<unknown>)=>work()}});
 mock.rpc.mockImplementation(async(name,args)=>{if(name==='get_finance_approval_policy')return {data:{version:1,tenant_id:tenant,revision:'a'.repeat(32),can_configure:true,policy:{enabled:false,operator_limit_cents:null,admin_limit_cents:null,prevent_self_approval:false}},error:null};if(mock.fail){mock.fail=false;throw Error('Resposta perdida');}return {data:{confirmed:true,tenant_id:tenant,request_id:args._payload.request_id},error:null};});
});afterEach(cleanup);
async function open(){const view=render(<QueryClientProvider client={new QueryClient()}><ApprovalPolicySettings tenant={tenant} actor={actor}/></QueryClientProvider>);const details=view.container.querySelector('details')!;details.open=true;fireEvent(details,new Event('toggle'));await screen.findByLabelText('Ativar alçadas');return view;}
it('does not change the current rule on opening and accepts zero as a configured role limit',async()=>{
 await open();expect(screen.getByLabelText('Ativar alçadas')).not.toBeChecked();expect(mock.rpc.mock.calls.every(([name])=>name==='get_finance_approval_policy')).toBe(true);
 fireEvent.click(screen.getByLabelText('Ativar alçadas'));fireEvent.change(screen.getByLabelText('Limite por aprovação de operador (R$)'),{target:{value:'0'}});fireEvent.change(screen.getByLabelText('Limite por aprovação de administrador (R$)'),{target:{value:'1000,50'}});fireEvent.change(screen.getByLabelText('Motivo da mudança'),{target:{value:'Política aprovada pela empresa'}});fireEvent.click(screen.getByRole('button',{name:'Salvar regra de aprovação'}));await screen.findByText('Regra de aprovação salva.');expect(mock.rpc).toHaveBeenCalledWith('save_finance_approval_policy',{_payload:expect.objectContaining({enabled:true,operator_limit_cents:'0',admin_limit_cents:'100050',tenant_id:tenant})});
});
it('recovers the exact configuration after closing the screen with an uncertain response',async()=>{
 const view=await open();fireEvent.change(screen.getByLabelText('Motivo da mudança'),{target:{value:'Manter a regra conferida'}});mock.fail=true;fireEvent.click(screen.getByRole('button',{name:'Salvar regra de aprovação'}));await screen.findByText('Resposta perdida');const first=mock.rpc.mock.calls.find(([name])=>name==='save_finance_approval_policy')![1];view.unmount();await open();fireEvent.click(screen.getByRole('button',{name:'Retomar configuração original'}));await waitFor(()=>expect(mock.rpc.mock.calls.filter(([name])=>name==='save_finance_approval_policy')).toHaveLength(2));expect(mock.rpc.mock.calls.filter(([name])=>name==='save_finance_approval_policy')[1][1]).toEqual(first);
});
