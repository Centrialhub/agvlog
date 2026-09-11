import {supabase} from '@/integrations/supabase/client';
import {legacyIntegritySchema} from './legacyIntegrityContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export async function readLegacyIntegrity(tenant:string,page=1){const {data,error}=await (supabase.rpc as unknown as Rpc)('get_finance_legacy_integrity_inventory',{_tenant_id:tenant,_page:page});if(error)throw error;const result=legacyIntegritySchema.parse(data);if(result.tenant_id!==tenant||result.page!==page)throw new Error('Pendências fora da empresa ou página.');return result;}
