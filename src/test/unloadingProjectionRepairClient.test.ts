import {beforeEach,expect,it,vi} from 'vitest';
import {readUnloadingProjectionRepairContext} from '@/lib/financial/unloadingProjectionRepairClient';
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
const id=(n:number)=>`af100000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const request={tenantId:id(1),actorId:id(2),chargeId:id(3)};
const fixture=()=>({version:1,tenant_id:id(1),actor_id:id(2),charge_id:id(3),receivable_id:id(4),revision:'a'.repeat(32),origin_verified:true,
 original:{supplier_id:id(5),supplier_name:'Fornecedor preservado',amount_cents:'15000',delivery_stop_id:id(6)},
 current:{receivable_id:id(4),client_id:id(7),amount_cents:'16000',status:'pending'},target:{client_id:id(5),amount_cents:'15000'},
 dependencies:[],blockers:[],eligible:true,can_repair:true,can_execute:false,history:[],effects:{cash_changed:false,charge_changed:false,cost_changed:false}});
beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({data:fixture(),error:null});});
it('reads only the scoped preview without providing a new supplier or amount',async()=>{
 const value=await readUnloadingProjectionRepairContext(request);
 expect(rpc).toHaveBeenCalledWith('get_finance_unloading_projection_repair_context',{_tenant_id:id(1),_charge_id:id(3)});
 expect(value.target).toEqual({client_id:id(5),amount_cents:'15000'});expect(value.can_execute).toBe(false);
});
it('refuses a result from another actor, tenant or charge',async()=>{
 for(const field of ['actor_id','tenant_id','charge_id']){rpc.mockResolvedValueOnce({data:{...fixture(),[field]:id(9)},error:null});await expect(readUnloadingProjectionRepairContext(request)).rejects.toThrow('fora');}
});
it('rejects leaked private evidence and contradictory execution or destination',async()=>{
 for(const change of [{_evidence:{secret:'private'}},{can_execute:true,can_repair:false},{target:{client_id:id(7),amount_cents:'15000'}},{eligible:true,blockers:[{code:'history',source_table:'receivables_payments',source_ids:[id(8)]}]}]){
  rpc.mockResolvedValueOnce({data:{...fixture(),...change},error:null});await expect(readUnloadingProjectionRepairContext(request)).rejects.toThrow();
 }
});
it('accepts a promoted confirmation only with eligibility and the actor permission',async()=>{
 rpc.mockResolvedValueOnce({data:{...fixture(),can_execute:true},error:null});expect((await readUnloadingProjectionRepairContext(request)).can_execute).toBe(true);
});
it('preserves a denied query as an error instead of presenting an eligible empty preview',async()=>{
 const error={code:'42501',message:'finance_access_denied'};rpc.mockResolvedValueOnce({data:null,error});await expect(readUnloadingProjectionRepairContext(request)).rejects.toBe(error);
});
