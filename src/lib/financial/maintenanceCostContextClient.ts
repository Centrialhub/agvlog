import {supabase} from '@/integrations/supabase/client';
import {maintenanceCostContextSchema} from './maintenanceCostContextContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string}|null}>;
export async function readMaintenanceCostContext(tenant:string,order:string,page=1){const {data,error}=await(supabase.rpc as unknown as Rpc)('get_finance_maintenance_cost_context',{_tenant_id:tenant,_order_id:order,_page:page});if(error)throw new Error(error.message);const result=maintenanceCostContextSchema.parse(data);if(result.tenant_id!==tenant||result.order_id!==order||result.page!==page)throw new Error('Consulta fora da ordem de manutenção.');return result;}
