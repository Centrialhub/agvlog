import {supabase} from '@/integrations/supabase/client';
import {payablePortfolioFiltersSchema,payablePortfolioSchema,type PayablePortfolioFilters} from './payablePortfolioContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export async function readPayablePortfolio(tenant:string,filters:PayablePortfolioFilters,page=1,revision:string|null=null){
 const input=payablePortfolioFiltersSchema.parse(filters);
 const {data,error}=await(supabase.rpc as unknown as Rpc)('get_finance_payable_portfolio',{_tenant_id:tenant,_filters:input,_page:page,_revision:revision});
 if(error)throw error;const result=payablePortfolioSchema.parse(data);
 if(result.tenant_id!==tenant||result.page!==page||result.date_basis!==input.date_basis||result.from!==input.from||result.to!==input.to||result.category!==input.category||result.supplier_id!==input.supplier_id||(revision!==null&&result.revision!==revision))throw new Error('Carteira fora da revisão ou filtros solicitados.');
 return result;
}
