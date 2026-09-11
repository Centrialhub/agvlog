import {supabase} from '@/integrations/supabase/client';
import {cashForecastComparisonResultSchema} from './cashForecastComparisonContract';
type Rpc=(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>;
export async function readCashForecastComparison(tenant:string,actor:string,snapshot:string){const {data,error}=await(supabase.rpc as unknown as Rpc)('get_finance_cash_forecast_comparison',{_tenant_id:tenant,_snapshot_id:snapshot});if(error)throw error;const result=cashForecastComparisonResultSchema.parse(data);if(result.tenant_id!==tenant||result.actor_id!==actor||result.snapshot_id!==snapshot)throw new Error('Comparação fora da previsão selecionada.');return result;}
