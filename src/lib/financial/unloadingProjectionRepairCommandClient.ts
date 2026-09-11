import {supabase} from '@/integrations/supabase/client';
import {unloadingProjectionRepairCommandSchema,type UnloadingProjectionRepairCommand} from './unloadingProjectionRepairCommandContract';
type Response={data:unknown;error:unknown};
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<Response>&{abortSignal:(signal:AbortSignal)=>PromiseLike<Response>};
// Keep database rejection codes intact for the durable request's outcome handling.
// A response is acknowledged only by the outbox, with its original actor/title.
export async function sendUnloadingProjectionRepair(command:UnloadingProjectionRepairCommand,signal?:AbortSignal):Promise<Response>{
 unloadingProjectionRepairCommandSchema.parse(command);
 const request=(supabase.rpc as unknown as Rpc)('repair_finance_unloading_projection',{_payload:command});
 return await(signal?request.abortSignal(signal):request);
}
