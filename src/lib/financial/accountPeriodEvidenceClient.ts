import {supabase} from '@/integrations/supabase/client';
import {accountPeriodEvidenceSchema} from './accountPeriodEvidenceContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string}|null}>;
export async function readAccountPeriodEvidence(tenant:string,account:string,closure:string){const {data,error}=await(supabase.rpc as unknown as Rpc)('get_finance_account_period_evidence',{_tenant_id:tenant,_account_id:account,_closure_id:closure});if(error)throw new Error(error.message);const result=accountPeriodEvidenceSchema.parse(data);if(result.tenant_id!==tenant||result.account_id!==account||result.closure_id!==closure)throw new Error('Evidências fora do fechamento selecionado.');return result;}
