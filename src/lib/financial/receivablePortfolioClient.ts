import {supabase} from '@/integrations/supabase/client';
import {receivablePortfolioSchema,type PortfolioFilters} from './receivablePortfolioContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export async function readReceivablePortfolio(tenant:string,filters:PortfolioFilters){const {data,error}=await (supabase.rpc as unknown as Rpc)('get_finance_receivable_portfolio_summary',{_tenant_id:tenant,_from:filters.from,_to:filters.to,_client_id:filters.client});if(error)throw error;const result=receivablePortfolioSchema.parse(data);if(result.tenant_id!==tenant||result.from!==filters.from||result.to!==filters.to||result.client_id!==filters.client)throw new Error('Carteira fora do filtro solicitado.');return result;}
