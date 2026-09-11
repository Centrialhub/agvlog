import {receivablesOriginPageSchema,type ReceivableListFilters} from './receivablesPageContract';
import {supabase} from '@/integrations/supabase/client';
import type {Receivable} from '@/hooks/useReceivables';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export async function readReceivablesPage(tenant:string,filters:ReceivableListFilters,page:number){
 const {data,error}=await (supabase.rpc as unknown as Rpc)('get_finance_receivables_page_by_origin',{_tenant_id:tenant,_search:filters.search,_status:filters.status,_client_id:filters.client==='all'?null:filters.client,_from:filters.from||null,_to:filters.to||null,_page:page,_origin:filters.origin||'all'});
 if(error)throw error;const result=receivablesOriginPageSchema.parse(data);if(result.tenant_id!==tenant||result.page!==page||result.origin_filter!==(filters.origin||'all'))throw new Error('Lista fora do contexto solicitado.');
 // The RPC preserves all original columns; validate the fields used by this screen before rendering.
 return {...result,rows:result.rows as unknown as Receivable[]};
}
