import {receivablesPageSchema,type ReceivableListFilters} from './receivablesPageContract';
import {supabase} from '@/integrations/supabase/client';
import type {Receivable} from '@/hooks/useReceivables';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export async function readReceivablesPage(tenant:string,filters:ReceivableListFilters,page:number){
 const {data,error}=await (supabase.rpc as unknown as Rpc)('get_finance_receivables_page',{_tenant_id:tenant,_search:filters.search,_status:filters.status,_client_id:filters.client==='all'?null:filters.client,_from:filters.from||null,_to:filters.to||null,_page:page});
 if(error)throw error;const result=receivablesPageSchema.parse(data);if(result.tenant_id!==tenant||result.page!==page)throw new Error('Lista fora do contexto solicitado.');
 // The RPC preserves all original columns; validate the fields used by this screen before rendering.
 return {...result,rows:result.rows as unknown as Receivable[]};
}
