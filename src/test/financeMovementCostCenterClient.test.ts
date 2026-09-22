import {beforeEach,expect,it,vi} from 'vitest';
import {recordFinanceMovement} from '@/lib/financial/ledgerClient';
import type {MovementCommand} from '@/lib/financial/ledgerContract';
const api=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:api.rpc}}));
const command:MovementCommand={version:1,tenant_id:crypto.randomUUID(),request_id:crypto.randomUUID(),bank_account_id:crypto.randomUUID(),cost_center_id:crypto.randomUUID(),direction:'out',nature:'payment',amount_cents:5000,occurred_on:'2026-09-01',description:'Manutenção',beneficiary_name:'Oficina',reason:'Pagamento conferido'};
const result={version:1,tenant_id:command.tenant_id,request_id:command.request_id,movement_id:crypto.randomUUID(),confirmed:true,cost_center_id:command.cost_center_id,cost_center_name:'Manutenção'};
beforeEach(()=>vi.clearAllMocks());
it('requires the server to acknowledge the chosen cost center',async()=>{
 api.rpc.mockResolvedValue({data:result,error:null});
 expect(await recordFinanceMovement(command)).toMatchObject({cost_center_id:command.cost_center_id});
 expect(api.rpc).toHaveBeenCalledWith('record_finance_movement',{_payload:command});
});
it.each([null,crypto.randomUUID()])('does not report success when the acknowledged center differs (%s)',async center=>{
 api.rpc.mockResolvedValue({data:{...result,cost_center_id:center},error:null});
 await expect(recordFinanceMovement(command)).rejects.toThrow('Finance cost center response mismatch');
});
