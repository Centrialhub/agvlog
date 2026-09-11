import {supabase} from '@/integrations/supabase/client';
import {periodMoneyPackageFiltersSchema,periodMoneyPackageSchema} from './periodMoneyPackageContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export async function readPeriodMoneyPackage(tenant:string,from:string,to:string,accountIds:string[]){
 periodMoneyPackageFiltersSchema.parse({tenant,from,to,accountIds});
 const {data,error}=await(supabase.rpc as unknown as Rpc)('get_finance_period_money_package',{_tenant_id:tenant,_from:from,_to:to,_account_ids:accountIds});
 if(error)throw error;const result=periodMoneyPackageSchema.parse(data);
 if(result.tenant_id!==tenant||result.period.from!==from||result.period.to!==to||result.account_scope.selected_ids.length!==accountIds.length||accountIds.some(id=>!result.account_scope.selected_ids.includes(id)))throw new Error('Pacote fora da empresa, período ou contas selecionadas.');
 return result;
}
