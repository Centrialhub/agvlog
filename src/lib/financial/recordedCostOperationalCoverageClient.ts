import {supabase} from '@/integrations/supabase/client';
import {recordedCostOperationalCoverageSchema} from './recordedCostOperationalCoverageContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export async function readRecordedCostOperationalCoverage(tenant:string,from:string,to:string){
 const {data,error}=await(supabase.rpc as unknown as Rpc)('get_finance_recorded_cost_operational_coverage',{_tenant_id:tenant,_from:from||null,_to:to||null});
 if(error)throw error;const parsed=recordedCostOperationalCoverageSchema.parse(data);
 if(parsed.tenant_id!==tenant||parsed.from!==(from||null)||parsed.to!==(to||null))throw new Error('finance_scope_mismatch');
 return parsed;
}
