import {it,expect,vi} from 'vitest';
import {readOpeningAccount,recordCashOpening} from '@/lib/financial/cashOpeningClient';
import {cashOpeningCommandSchema} from '@/lib/financial/cashOpeningContract';
const mock=vi.hoisted(()=>({rpc:vi.fn(),single:vi.fn(),eq:vi.fn(),select:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:()=>({select:mock.select})}}));
const tenant=crypto.randomUUID(),account=crypto.randomUUID(),command={version:1 as const,tenant_id:tenant,request_id:crypto.randomUUID(),account_id:account,effective_from:'2026-01-02',custodian_name:'Ana Custódia',reason:'Contagem no início do dia',counts:[{denomination_cents:10000,quantity:2},{denomination_cents:500,quantity:1}]};
it('validates account identity and type from the selected tenant',async()=>{
 mock.select.mockReturnValue({eq:mock.eq});mock.eq.mockReturnValue({eq:mock.eq,single:mock.single});mock.single.mockResolvedValueOnce({error:null,data:{id:account,tenant_id:tenant,name:'Caixa',account_type:'cash',active:true}});await expect(readOpeningAccount(tenant,account)).resolves.toMatchObject({account_type:'cash'});expect(mock.eq).toHaveBeenCalledWith('tenant_id',tenant);expect(mock.eq).toHaveBeenCalledWith('id',account);
 mock.single.mockResolvedValueOnce({error:null,data:{id:crypto.randomUUID(),tenant_id:tenant,name:'Outra conta',account_type:'cash',active:true}});await expect(readOpeningAccount(tenant,account)).rejects.toThrow('fora do contexto');
});
it('accepts the server total only if it matches the exact count and preserves cash_created false',async()=>{
 const data={version:1,tenant_id:tenant,request_id:command.request_id,opening_id:crypto.randomUUID(),balance_cents:'20500',evidence_type:'cash_count_v1',confirmed:true,cash_created:false};mock.rpc.mockResolvedValueOnce({error:null,data});await expect(recordCashOpening(command)).resolves.toMatchObject({balance_cents:'20500'});expect(mock.rpc).toHaveBeenLastCalledWith('record_finance_cash_opening',{_payload:command});
 mock.rpc.mockResolvedValueOnce({error:null,data:{...data,balance_cents:'20000'}});await expect(recordCashOpening(command)).rejects.toThrow('fora do pedido');mock.rpc.mockResolvedValueOnce({error:null,data:{...data,cash_created:true}});await expect(recordCashOpening(command)).rejects.toThrow();
});
it('rejects duplicate, fractional and unknown denominations but permits a reviewed zero count',()=>{
 expect(cashOpeningCommandSchema.safeParse({...command,counts:[command.counts[0],command.counts[0]]}).success).toBe(false);expect(cashOpeningCommandSchema.safeParse({...command,counts:[{denomination_cents:10000,quantity:1.5}]}).success).toBe(false);expect(cashOpeningCommandSchema.safeParse({...command,counts:[{denomination_cents:300,quantity:1}]}).success).toBe(false);expect(cashOpeningCommandSchema.safeParse({...command,counts:[{denomination_cents:10000,quantity:0}]}).success).toBe(true);
});
