import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {unloadingProjectionRepairContextSchema} from './unloadingProjectionRepairContract';
const scope=z.object({tenantId:z.string().uuid(),actorId:z.string().uuid(),chargeId:z.string().uuid()});
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export async function readUnloadingProjectionRepairContext(request:z.infer<typeof scope>){
 const input=scope.parse(request);
 const {data,error}=await(supabase.rpc as unknown as Rpc)('get_finance_unloading_projection_repair_context',{_tenant_id:input.tenantId,_charge_id:input.chargeId});
 if(error)throw error;
 const result=unloadingProjectionRepairContextSchema.parse(data);
 if(result.tenant_id!==input.tenantId||result.actor_id!==input.actorId||result.charge_id!==input.chargeId)throw new Error('Consulta da descarga fora da empresa, sessão ou origem solicitadas.');
 return result;
}
