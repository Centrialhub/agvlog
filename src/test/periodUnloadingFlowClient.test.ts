import {beforeEach,it,expect,vi} from 'vitest';
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
import {readPeriodUnloadingFlow,PeriodUnloadingFlowChangedError,PeriodUnloadingMoneyPackageChangedError} from '@/lib/financial/periodUnloadingFlowClient';
import {periodUnloadingFlowSchema,type PeriodUnloadingFlow} from '@/lib/financial/periodUnloadingFlowContract';
const ids={tenant:'00000000-0000-4000-8000-000000000001',account:'00000000-0000-4000-8000-000000000002',other:'00000000-0000-4000-8000-000000000003'};
const request={tenantId:ids.tenant,from:'2026-01-01',to:'2026-01-31',accountIds:[ids.account],supplierId:null,page:1,expectedRevision:null,expectedMoneyPackageRevision:'b'.repeat(32)};
function fixture():PeriodUnloadingFlow{return {
 version:1,tenant_id:ids.tenant,period:{from:request.from,to:request.to},currency:'BRL',timezone:'America/Sao_Paulo',basis:'economic_event_dates',evidence_basis:'currently_available_immutable_records',not_a_position:true,captured_at:'2026-09-10T20:00:00Z',revision:'a'.repeat(32),money_package_revision:request.expectedMoneyPackageRevision,
 supplier_id:null,supplier_options:[],account_scope:{selected_ids:[ids.account],excluded_ids:[],complete:true},page:1,page_size:50,total:0,unknown_date_count:0,
 origin_totals:{count:0,valid:true,amount_cents:'0'},receipt_totals:{count:0,valid:true,amount_cents:'0'},refund_totals:{count:0,valid:true,amount_cents:'0'},supplier_groups:[],rows:[],money_links:[],issues:[],limitations:[],
};}
beforeEach(()=>{rpc.mockReset();});
it('sends only the documented RPC scope and verifies the expected money package',async()=>{
 rpc.mockResolvedValue({data:fixture(),error:null});expect(await readPeriodUnloadingFlow(request)).toEqual(fixture());
 expect(rpc).toHaveBeenCalledWith('get_finance_period_unloading_flow',{_tenant_id:ids.tenant,_from:request.from,_to:request.to,_account_ids:[ids.account],_supplier_id:null,_page:1,_expected_revision:null});
});
it('rejects a stale money package independently of the flow revision',async()=>{
 rpc.mockResolvedValue({data:{...fixture(),money_package_revision:'c'.repeat(32)},error:null});
 await expect(readPeriodUnloadingFlow(request)).rejects.toBeInstanceOf(PeriodUnloadingMoneyPackageChangedError);
});
it('does not mix tenant, period, supplier or account selection',async()=>{
 for(const patch of [{tenant_id:ids.other},{period:{from:'2026-02-01',to:'2026-02-28'}},{supplier_id:ids.other},{account_scope:{selected_ids:[ids.other],excluded_ids:[],complete:true}}]){
  rpc.mockResolvedValue({data:{...fixture(),...patch},error:null});await expect(readPeriodUnloadingFlow(request)).rejects.toThrow();
 }
});
it('distinguishes changed flow from denied access and checks successful response revisions',async()=>{
 rpc.mockResolvedValue({data:null,error:{code:'40001'}});await expect(readPeriodUnloadingFlow(request)).rejects.toBeInstanceOf(PeriodUnloadingFlowChangedError);
 const denied={code:'42501'};rpc.mockResolvedValue({data:null,error:denied});await expect(readPeriodUnloadingFlow(request)).rejects.toBe(denied);
 rpc.mockResolvedValue({data:fixture(),error:null});await expect(readPeriodUnloadingFlow({...request,expectedRevision:'c'.repeat(32)})).rejects.toBeInstanceOf(PeriodUnloadingFlowChangedError);
});
it('refuses repeated accounts or navigation without a revision before requesting SQL',async()=>{
 await expect(readPeriodUnloadingFlow({...request,accountIds:[ids.account,ids.account]})).rejects.toThrow();
 await expect(readPeriodUnloadingFlow({...request,page:2})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();
});
function cancellation():PeriodUnloadingFlow{
 const data=fixture(),adjustment={count:1,valid:true,amount_cents:'-15000'};
 return {...data,version:2,total:1,adjustment_totals:adjustment,net_origin_totals:adjustment,
  supplier_groups:[{supplier_id:ids.other,supplier_name:'Fornecedor original',origin_totals:data.origin_totals,receipt_totals:data.receipt_totals,refund_totals:data.refund_totals,adjustment_totals:adjustment,net_origin_totals:adjustment}],
  rows:[{event_id:ids.account,kind:'adjustment',charge_id:ids.tenant,receivable_id:ids.other,supplier_id:ids.other,supplier_name:'Fornecedor original',delivery_stop_id:ids.tenant,
   economic_on:'2026-01-20',recorded_at:'2026-09-10T20:00:00Z',amount_cents:'-15000',valid:true,issues:[],original_due_date:null,original_command_id:null,receipt_path:null,document_ids:[],
   payment_id:null,reversal_id:null,command_id:null,movement_id:null,bank_account_id:null,money_covered:false,closure_ids:[],sidecars:[],amendment_id:ids.account,adjustment_leg:'release',amendment_actor_id:ids.tenant,amendment_actor_name:'Responsável',amendment_reason:'Cancelamento da cobrança registrado'}]};
}
it('reads a negative adjustment in a later period without treating it as cash or an outstanding balance',async()=>{
 rpc.mockResolvedValue({data:cancellation(),error:null});expect(await readPeriodUnloadingFlow(request)).toEqual(cancellation());
});
it('rejects adjustment money, wrong signs, missing authorship and inconsistent net totals',()=>{
 for(const patch of [{movement_id:ids.account},{amount_cents:'15000'},{amendment_actor_id:null},{amendment_id:ids.other}]){
  const data=cancellation();Object.assign(data.rows[0],patch);expect(periodUnloadingFlowSchema.safeParse(data).success).toBe(false);
 }
 const data=cancellation();data.net_origin_totals={count:1,valid:true,amount_cents:'0'};expect(periodUnloadingFlowSchema.safeParse(data).success).toBe(false);
});
it('requires the full v2 aggregate contract and refuses adjustments disguised as v1',()=>{
 const data=cancellation();delete data.adjustment_totals;expect(periodUnloadingFlowSchema.safeParse(data).success).toBe(false);
 expect(periodUnloadingFlowSchema.safeParse({...cancellation(),version:1}).success).toBe(false);
});
