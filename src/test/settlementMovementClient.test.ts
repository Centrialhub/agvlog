import {beforeEach,it,expect,vi} from 'vitest';
import {linkSettlementMovement,reverseSettlementMovement,readSettlementMovements,SettlementMovementRejectedError} from '@/lib/financial/settlementMovementClient';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
const command={version:1 as const,tenant_id:crypto.randomUUID(),request_id:crypto.randomUUID(),payment_id:crypto.randomUUID(),movement_id:crypto.randomUUID(),reason:'Conferido pelo financeiro'};
const response={...command,settlement_id:crypto.randomUUID(),link_id:crypto.randomUUID(),amount_cents:10000,cash_created:false,confirmed:true};
beforeEach(()=>vi.clearAllMocks());
it('validates response identity and that no cash was created',async()=>{
 mock.rpc.mockResolvedValueOnce({data:response,error:null});expect(await linkSettlementMovement(command)).toMatchObject({cash_created:false});
 mock.rpc.mockResolvedValueOnce({data:{...response,payment_id:crypto.randomUUID()},error:null});await expect(linkSettlementMovement(command)).rejects.toThrow('fora do contexto');
 mock.rpc.mockResolvedValueOnce({data:{...response,cash_created:true},error:null});await expect(linkSettlementMovement(command)).rejects.toThrow();
});
it('distinguishes database rejection from transport failure',async()=>{
 mock.rpc.mockResolvedValueOnce({data:null,error:{message:'finance_movement_overallocated',code:'23514'}});await expect(linkSettlementMovement(command)).rejects.toBeInstanceOf(SettlementMovementRejectedError);
 mock.rpc.mockResolvedValueOnce({data:null,error:{message:'gateway timeout',code:'504'}});try{await linkSettlementMovement(command);throw new Error('Expected rejection');}catch(error){expect(error).not.toBeInstanceOf(SettlementMovementRejectedError);expect((error as Error).message).toBe('gateway timeout');}
});
it('rejects a read response for another payment',async()=>{
 mock.rpc.mockResolvedValue({error:null,data:{version:1,tenant_id:command.tenant_id,payment_id:crypto.randomUUID(),settlement_id:response.settlement_id,amount_cents:10000,page:1,page_size:20,total:0,link:null,history:[],rows:[]}});
 await expect(readSettlementMovements(command.tenant_id,command.payment_id,1)).rejects.toThrow('fora do contexto');
});
it('validates reversal identity and unchanged cash',async()=>{
 const reversal={version:1 as const,tenant_id:command.tenant_id,request_id:crypto.randomUUID(),link_id:response.link_id,reason:'Vínculo incorreto identificado'};
 const result={...reversal,reversal_id:crypto.randomUUID(),cash_changed:false,confirmed:true};
 mock.rpc.mockResolvedValueOnce({error:null,data:result});await expect(reverseSettlementMovement(reversal)).resolves.toMatchObject({cash_changed:false});expect(mock.rpc).toHaveBeenLastCalledWith('reverse_finance_settlement_link',{_payload:reversal});
 mock.rpc.mockResolvedValueOnce({error:null,data:{...result,link_id:crypto.randomUUID()}});await expect(reverseSettlementMovement(reversal)).rejects.toThrow('fora do contexto');
 mock.rpc.mockResolvedValueOnce({error:null,data:{...result,cash_changed:true}});await expect(reverseSettlementMovement(reversal)).rejects.toThrow();
});

it('classifies movement concurrency as a known rollback',async()=>{mock.rpc.mockResolvedValueOnce({data:null,error:{code:'40001',message:'finance_movement_use_busy'}});await expect(linkSettlementMovement(command)).rejects.toBeInstanceOf(SettlementMovementRejectedError);});
