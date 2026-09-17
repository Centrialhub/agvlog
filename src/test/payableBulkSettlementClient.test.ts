import {expect,it,vi} from 'vitest';
import {applyPayableBulkSettlement,PayableBulkRejectedError,readPayableBulkContext} from '@/lib/financial/payableBulkSettlementClient';

const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));

const command={version:1 as const,tenant_id:crypto.randomUUID(),request_id:crypto.randomUUID(),movement_id:crypto.randomUUID(),bank_account_id:crypto.randomUUID(),paid_on:'2026-09-14',expected_revision:'a'.repeat(32),items:[{payable_id:crypto.randomUUID(),amount_cents:'100'},{payable_id:crypto.randomUUID(),amount_cents:'200'}],method:'pix' as const,reason:'Pagamento agrupado revisado'};

it('classifies authoritative business rejection as definite and transport failure as uncertain',async()=>{
  mock.rpc.mockResolvedValueOnce({data:null,error:{code:'P0001',message:'finance_payable_bulk_changed'}});
  await expect(applyPayableBulkSettlement(command,crypto.randomUUID())).rejects.toBeInstanceOf(PayableBulkRejectedError);
  mock.rpc.mockResolvedValueOnce({data:null,error:{code:'504',message:'timeout'}});
  await expect(applyPayableBulkSettlement(command,crypto.randomUUID())).rejects.not.toBeInstanceOf(PayableBulkRejectedError);
});

it('rejects another actor and duplicate or arithmetically inconsistent confirmation rows',async()=>{
  const actor=crypto.randomUUID(),rows=command.items.map(item=>({payable_id:item.payable_id,payment_id:crypto.randomUUID(),link_id:crypto.randomUUID(),amount_cents:item.amount_cents}));
  const result={version:1,tenant_id:command.tenant_id,actor_id:actor,request_id:command.request_id,movement_id:command.movement_id,bank_account_id:command.bank_account_id,paid_on:command.paid_on,total_cents:'300',rows,bank_confirmation:'not_evaluated',cash_created:false,confirmed:true};
  mock.rpc.mockResolvedValueOnce({data:{...result,actor_id:crypto.randomUUID()},error:null});
  await expect(applyPayableBulkSettlement(command,actor)).rejects.toThrow('fora do contexto');
  mock.rpc.mockResolvedValueOnce({data:{...result,rows:[rows[0],{...rows[1],payable_id:rows[0].payable_id}]},error:null});
  await expect(applyPayableBulkSettlement(command,actor)).rejects.toThrow();
  mock.rpc.mockResolvedValueOnce({data:{...result,total_cents:'301'},error:null});
  await expect(applyPayableBulkSettlement(command,actor)).rejects.toThrow();
});

it('rejects a preview for another actor or with duplicated title evidence',async()=>{
  const actor=crypto.randomUUID(),items=command.items,contextItems=items.map(item=>({payable_id:item.payable_id,supplier_id:null,supplier_name:'Fornecedor',description:'Título',status:'approved',driver_id:null,nominal_cents:item.amount_cents,paid_cents:'0',remaining_cents:item.amount_cents,amount_cents:item.amount_cents,eligible:true,issue:null}));
  const context={version:1,tenant_id:command.tenant_id,actor_id:actor,movement:{id:command.movement_id,bank_account_id:command.bank_account_id,account_name:'Conta',occurred_on:command.paid_on,beneficiary_name:'Fornecedor',bank_reference:null,description:'Saída',receipt_path:null,amount_cents:'300',remaining_cents:'300'},items:contextItems,total_cents:'300',blockers:[],eligible:true,expected_revision:command.expected_revision};
  mock.rpc.mockResolvedValueOnce({data:{...context,actor_id:crypto.randomUUID()},error:null});
  await expect(readPayableBulkContext(command.tenant_id,actor,command.movement_id,items)).rejects.toThrow('fora do contexto');
  mock.rpc.mockResolvedValueOnce({data:{...context,items:[contextItems[0],{...contextItems[1],payable_id:contextItems[0].payable_id}]},error:null});
  await expect(readPayableBulkContext(command.tenant_id,actor,command.movement_id,items)).rejects.toThrow();
});
