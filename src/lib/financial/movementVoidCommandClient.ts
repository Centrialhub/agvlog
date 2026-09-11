import {supabase} from '@/integrations/supabase/client';
import {movementVoidCommandSchema,movementVoidResultSchema,type MovementVoidCommand} from './movementVoidCommandContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string;code?:string}|null}>;
export class MovementVoidRejectedError extends Error {}
export async function submitMovementVoid(command:MovementVoidCommand){
 // Validate without rewriting the durable request used for identical replay.
 movementVoidCommandSchema.parse(command);
 const {data,error}=await(supabase.rpc as unknown as Rpc)('void_finance_manual_movement',{_payload:command});
 if(error){if(['22023','23514','23505','40001','42501','55000'].includes(error.code||''))throw new MovementVoidRejectedError(error.message);throw new Error(error.message);}
 const result=movementVoidResultSchema.parse(data);
 if(result.tenant_id!==command.tenant_id||result.movement_id!==command.movement_id||result.request_id!==command.request_id||result.reason!==command.reason.trim())throw new Error('Resposta fora do pedido de invalidação original.');
 return result;
}
