import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
const uuid=z.string().uuid(),count=z.number().int().nonnegative();
const row=z.object({source_table:z.string(),source_id:uuid,occurred_on:z.string(),amount_cents:z.string().regex(/^\d+$/).nullable(),direction:z.enum(['in','out','unknown']),account_id:uuid.nullable(),bank_transaction_id:uuid.nullable(),reason:z.string(),context:z.object({amount_status:z.string(),account_status:z.string(),origin_ids:z.record(uuid.nullable()).nullable()})});
const section=z.object({page:z.number().int().positive(),page_size:z.literal(30),total:count,counts_by_source:z.record(count),rows:z.array(row)});
export const legacyInventorySchema=section.extend({version:z.literal(1),tenant_id:uuid,account_id:uuid,from:z.string(),to:z.string(),unknown_account:section.extend({scope:z.literal('tenant'),not_additive_across_accounts:z.literal(true)}),legacy_integration_status:z.literal('not_reviewed'),can_close:z.literal(false)});
export type LegacyInventoryRow=z.infer<typeof row>;
export async function readLegacyInventory(tenant:string,account:string,from:string,to:string,page:number){
 const {data,error}=await (supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>)('get_finance_legacy_adoption_inventory',{_tenant_id:tenant,_account_id:account,_from:from,_to:to,_page:page});
 if(error)throw error;const result=legacyInventorySchema.parse(data);
 if(result.tenant_id!==tenant||result.account_id!==account||result.from!==from||result.to!==to||result.page!==page||result.unknown_account.page!==page||result.rows.some(item=>item.account_id!==account)||result.unknown_account.rows.some(item=>item.account_id!==null))throw new Error('Inventário fora do contexto da conta e período.');
 return result;
}
