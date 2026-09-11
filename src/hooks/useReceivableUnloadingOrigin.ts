import {useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
const uuid=z.string().uuid();
const sourceSchema=z.object({id:uuid,tenant_id:uuid,receivable_id:uuid,supplier_id:uuid,delivery_stop_id:uuid,amount_cents:z.union([z.number().int().positive().max(99999999999999),z.string().regex(/^[1-9]\d{0,13}$/)]),source_snapshot:z.record(z.unknown())});
export type ReceivableUnloadingOrigin=z.infer<typeof sourceSchema>;
type Reader={from:(table:string)=>{select:(columns:string)=>{eq:(field:string,value:string)=>{eq:(field:string,value:string)=>{maybeSingle:()=>PromiseLike<{data:unknown;error:unknown}>}}}}};
export async function readReceivableUnloadingOrigin(tenant:string,receivable:string){
 uuid.parse(tenant);uuid.parse(receivable);
 const {data,error}=await(supabase as unknown as Reader).from('finance_unloading_charges').select('id,tenant_id,receivable_id,supplier_id,delivery_stop_id,amount_cents,source_snapshot').eq('tenant_id',tenant).eq('receivable_id',receivable).maybeSingle();
 if(error)throw error;if(data===null)return null;const result=sourceSchema.parse(data);if(result.tenant_id!==tenant||result.receivable_id!==receivable)throw Error('Origem fora do título ou da empresa.');return result;
}
export function useReceivableUnloadingOrigin(tenant:string|undefined,actor:string|undefined,receivable:string|null){return useQuery({queryKey:['finance-receivable-unloading-origin',tenant,actor,receivable],queryFn:()=>readReceivableUnloadingOrigin(tenant!,receivable!),enabled:!!tenant&&!!actor&&!!receivable,retry:false,staleTime:0});}
