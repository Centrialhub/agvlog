import {supabase} from '@/integrations/supabase/client';
import {payableBulkContextSchema,payableBulkItemsSchema,payableBulkResultSchema,type PayableBulkCommand} from './payableBulkSettlementContract';

type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string;code?:string}|null}>;
export class PayableBulkRejectedError extends Error{}
async function rpc(name:string,args:Record<string,unknown>){
  const {data,error}=await(supabase.rpc.bind(supabase) as unknown as Rpc)(name,args);
  if(error){if((/^(22|23|40|42|55)/.test(error.code??'')||error.code==='P0001')&&error.message.startsWith('finance_'))throw new PayableBulkRejectedError(error.message);throw new Error(error.message);}
  return data;
}
export async function readPayableBulkContext(tenant:string,actor:string,movement:string,items:unknown){
  const requested=payableBulkItemsSchema.parse(items);
  const result=payableBulkContextSchema.parse(await rpc('get_finance_payable_bulk_context',{_tenant_id:tenant,_movement_id:movement,_items:requested}));
  if(result.tenant_id!==tenant||result.actor_id!==actor||result.movement.id!==movement||result.items.length!==requested.length||result.items.some(row=>!requested.some(item=>item.payable_id===row.payable_id&&item.amount_cents===row.amount_cents)))throw new Error('Prévia de baixa fora do contexto solicitado.');
  return result;
}
export async function applyPayableBulkSettlement(command:PayableBulkCommand,actor:string){
  const result=payableBulkResultSchema.parse(await rpc('apply_finance_payable_bulk_movement',{_payload:command}));
  if(result.tenant_id!==command.tenant_id||result.actor_id!==actor||result.request_id!==command.request_id||result.movement_id!==command.movement_id||result.bank_account_id!==command.bank_account_id||result.paid_on!==command.paid_on||result.rows.length!==command.items.length||result.rows.some(row=>!command.items.some(item=>item.payable_id===row.payable_id&&item.amount_cents===row.amount_cents)))throw new Error('Resposta da baixa em lote fora do contexto.');
  return result;
}
