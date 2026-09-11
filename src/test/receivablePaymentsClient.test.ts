import {beforeEach,it,expect,vi} from 'vitest';
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
import {readReceivablePayments,ReceivablePaymentsChangedError} from '@/lib/financial/receivablePaymentsClient';
import {receivablePaymentsPageSchema,type ReceivablePaymentsPage} from '@/lib/financial/receivablePaymentsContract';
const ids={tenant:'00000000-0000-4000-8000-000000000001',actor:'00000000-0000-4000-8000-000000000002',title:'00000000-0000-4000-8000-000000000003',payment:'00000000-0000-4000-8000-000000000004'};
const request={tenantId:ids.tenant,actorId:ids.actor,receivableId:ids.title,page:1,expectedRevision:null};
function fixture():ReceivablePaymentsPage{return {version:1,tenant_id:ids.tenant,actor_id:ids.actor,receivable_id:ids.title,page:1,page_size:50,total:1,revision:'a'.repeat(32),rows:[{id:ids.payment,amount_cents:100,received_at:'2026-09-10T12:00:00.123456+00:00',method:'pix',notes:null,bank_account_id:null,bank_account_name:null,attachment_path:null,reversed_at:null,reversal_reason:null,credit_id:null,allocation_correction:null}]};}
beforeEach(()=>{rpc.mockReset();});
it('requests the page and validates its session and financial scope',async()=>{
 const data=fixture();rpc.mockResolvedValue({data,error:null});expect(await readReceivablePayments(request)).toEqual(data);
 expect(rpc).toHaveBeenCalledWith('get_finance_receivable_payments_page',{_tenant_id:ids.tenant,_receivable_id:ids.title,_page:1,_expected_revision:null});
 for(const patch of [{actor_id:ids.payment},{tenant_id:ids.payment},{receivable_id:ids.payment}]){
  rpc.mockResolvedValue({data:{...data,...patch},error:null});await expect(readReceivablePayments(request)).rejects.toThrow('fora do contexto');
 }
});
it('requires stable pagination and treats a changed response revision as stale',async()=>{
 await expect(readReceivablePayments({...request,page:2})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();
 rpc.mockResolvedValue({data:fixture(),error:null});await expect(readReceivablePayments({...request,expectedRevision:'b'.repeat(32)})).rejects.toBeInstanceOf(ReceivablePaymentsChangedError);
});
it('separates server revision changes from access and network failure',async()=>{
 rpc.mockResolvedValue({data:null,error:{code:'40001'}});await expect(readReceivablePayments(request)).rejects.toBeInstanceOf(ReceivablePaymentsChangedError);
 const denial={code:'42501'};rpc.mockResolvedValue({data:null,error:denial});await expect(readReceivablePayments(request)).rejects.toBe(denial);
 const network=new Error('offline');rpc.mockRejectedValue(network);await expect(readReceivablePayments(request)).rejects.toBe(network);
});
it('rejects missing rows, repeated payments and omitted correction state',()=>{
 const data=fixture();data.total=2;expect(receivablePaymentsPageSchema.safeParse(data).success).toBe(false);
 data.rows.push(structuredClone(data.rows[0]));expect(receivablePaymentsPageSchema.safeParse(data).success).toBe(false);
 const missing={...fixture(),rows:[{...fixture().rows[0],allocation_correction:undefined}]};expect(receivablePaymentsPageSchema.safeParse(missing).success).toBe(false);
});
it('preserves timestamp precision without using millisecond ties to reorder real events',()=>{
 const data=fixture();data.total=2;data.rows[0].id='00000000-0000-4000-8000-000000000099';
 data.rows.push({...data.rows[0],id:ids.payment,received_at:'2026-09-10T12:00:00.123455+00:00'});
 expect(receivablePaymentsPageSchema.safeParse(data).success).toBe(true);
 data.rows[1].received_at=data.rows[0].received_at;expect(receivablePaymentsPageSchema.safeParse(data).success).toBe(false);
});
