import {supabase} from '@/integrations/supabase/client';
import {settlementMovementCommandSchema,settlementMovementResultSchema,settlementMovementOptionsSchema,settlementReversalCommandSchema,settlementReversalResultSchema,type SettlementReversalCommand,type SettlementMovementCommand} from './settlementMovementContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string;code?:string}|null}>;
export class SettlementMovementRejectedError extends Error {}
async function rpc(name:string,args:Record<string,unknown>){
 const {data,error}=await (supabase.rpc as unknown as Rpc)(name,args);
 if(error){if(['22023','23514','23505','40001','42501'].includes(error.code||''))throw new SettlementMovementRejectedError(error.message);throw new Error(error.message);}return data;
}
export async function linkSettlementMovement(command:SettlementMovementCommand){
 settlementMovementCommandSchema.parse(command);
 const result=settlementMovementResultSchema.parse(await rpc('link_finance_settlement_payment',{_payload:command}));
 if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id||result.payment_id!==command.payment_id||result.movement_id!==command.movement_id)throw new Error('Vínculo fora do contexto.');return result;
}
export async function readSettlementMovements(tenant:string,payment:string,page:number){
 const result=settlementMovementOptionsSchema.parse(await rpc('get_finance_settlement_payment_movements',{_tenant_id:tenant,_payment_id:payment,_page:page}));
 if(result.tenant_id!==tenant||result.payment_id!==payment||result.page!==page)throw new Error('Pagamentos fora do contexto.');return result;
}
export async function reverseSettlementMovement(command:SettlementReversalCommand){
 settlementReversalCommandSchema.parse(command);
 const result=settlementReversalResultSchema.parse(await rpc('reverse_finance_settlement_link',{_payload:command}));
 if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id||result.link_id!==command.link_id)throw new Error('Correção de vínculo fora do contexto.');return result;
}
