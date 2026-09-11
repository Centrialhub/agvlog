import {beforeEach,it,expect,vi} from 'vitest';
import {readLegacyReceivableAssociation,submitLegacyReceivableAssociation,LegacyReceivableRejectedError} from '@/lib/financial/legacyReceivableAssociationClient';
import {legacyReceivablePendingSchema} from '@/lib/financial/legacyReceivableAssociationContract';
const rpc=vi.hoisted(()=>vi.fn());vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));beforeEach(()=>rpc.mockReset());
const tenant=crypto.randomUUID(),payment=crypto.randomUUID(),movement=crypto.randomUUID(),link=crypto.randomUUID();
const pending=legacyReceivablePendingSchema.parse({kind:'associate',command:{version:1,tenant_id:tenant,request_id:crypto.randomUUID(),payment_id:payment,movement_id:movement,revision:'source-1',existing_receipt_confirmed:true,reason:'Recebimento antigo conferido'}});
const result={version:1,tenant_id:tenant,request_id:pending.command.request_id,payment_id:payment,receivable_id:crypto.randomUUID(),movement_id:movement,link_id:link,origin:'legacy_adoption',amount_cents:'50000',bank_transaction_id:null,cash_created:false,payment_created:false,confirmed:true};
it('associates existing IDs only and rejects a response creating cash or another payment',async()=>{
 rpc.mockResolvedValue({data:result,error:null});await submitLegacyReceivableAssociation(pending);expect(rpc).toHaveBeenCalledWith('associate_finance_legacy_receivable_payment',{_payload:pending.command});
 for(const override of [{cash_created:true},{payment_created:true},{payment_id:crypto.randomUUID()}]){rpc.mockResolvedValue({data:{...result,...override},error:null});await expect(submitLegacyReceivableAssociation(pending)).rejects.toThrow();}
});
it('reverses only the association and validates link identity and unchanged payment',async()=>{
 const reverse=legacyReceivablePendingSchema.parse({kind:'reverse',command:{version:1,tenant_id:tenant,request_id:crypto.randomUUID(),link_id:link,reason:'Associação incorreta conferida'}}),response={...result,request_id:reverse.command.request_id,reversal_id:crypto.randomUUID(),released_cents:'50000',cash_changed:false,payment_changed:false};rpc.mockResolvedValue({data:response,error:null});await submitLegacyReceivableAssociation(reverse);expect(rpc).toHaveBeenCalledWith('reverse_finance_legacy_receivable_association',{_payload:reverse.command});
 for(const override of [{payment_changed:true},{link_id:crypto.randomUUID()}]){rpc.mockResolvedValue({data:{...response,...override},error:null});await expect(submitLegacyReceivableAssociation(reverse)).rejects.toThrow();}
});
it('preserves uncertainty as distinct from a known transactional rejection',async()=>{
 expect(legacyReceivablePendingSchema.safeParse({...pending,command:{...pending.command,existing_receipt_confirmed:false}}).success).toBe(false);
 rpc.mockResolvedValue({data:null,error:{code:'23514',message:'finance_movement_overallocated'}});await expect(submitLegacyReceivableAssociation(pending)).rejects.toBeInstanceOf(LegacyReceivableRejectedError);rpc.mockResolvedValue({data:null,error:{code:'08006',message:'connection lost'}});try{await submitLegacyReceivableAssociation(pending);}catch(e){expect(e).not.toBeInstanceOf(LegacyReceivableRejectedError);}
});
it('validates tenant, payment, page and nested identity of the paginated consultation',async()=>{
 const response={version:1,tenant_id:tenant,payment_id:payment,revision:'source-1',page:2,page_size:20,total:0,rows:[],payment:{id:payment,receivable_id:result.receivable_id,bank_account_id:null,account_name:null,payer_name:null,received_on:null,amount_cents:null,bank_transaction_id:null,driver_id:null},eligible:false,issue:'finance_legacy_payment_account_invalid',active_link:null,history_total:0,history:[]};rpc.mockResolvedValue({data:response,error:null});await readLegacyReceivableAssociation(tenant,payment,2);expect(rpc).toHaveBeenCalledWith('get_finance_legacy_receivable_association',{_tenant_id:tenant,_payment_id:payment,_page:2});
 for(const override of [{tenant_id:crypto.randomUUID()},{page:1},{payment:{...response.payment,id:crypto.randomUUID()}}]){rpc.mockResolvedValue({data:{...response,...override},error:null});await expect(readLegacyReceivableAssociation(tenant,payment,2)).rejects.toThrow();}
});
