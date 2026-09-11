import {supabase} from '@/integrations/supabase/client';
import {unbilledFreightOriginsSchema,unbilledFreightSummarySchema,type FreightFilters,type FreightState} from './unbilledFreightContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
async function rpc(name:string,args:Record<string,unknown>){const {data,error}=await (supabase.rpc as unknown as Rpc)(name,args);if(error)throw error;return data;}
function args(tenant:string,filters:FreightFilters){return {_tenant_id:tenant,_from:filters.from,_to:filters.to,_client_id:filters.client};}
function scoped(data:{tenant_id:string;from:string|null;to:string|null;client_id:string|null},tenant:string,filters:FreightFilters){if(data.tenant_id!==tenant||data.from!==filters.from||data.to!==filters.to||data.client_id!==filters.client)throw new Error('Previsão fora do filtro solicitado.');}
export async function readUnbilledFreightSummary(tenant:string,filters:FreightFilters){const data=unbilledFreightSummarySchema.parse(await rpc('get_finance_unbilled_freight_summary',args(tenant,filters)));scoped(data,tenant,filters);return data;}
export async function readUnbilledFreightOrigins(tenant:string,filters:FreightFilters,state:FreightState|null,page:number){const data=unbilledFreightOriginsSchema.parse(await rpc('list_finance_unbilled_freight_origins',{...args(tenant,filters),_state:state,_page:page}));scoped(data,tenant,filters);if(data.state!==state||data.page!==page)throw new Error('Lista de origens fora do filtro solicitado.');return data;}
