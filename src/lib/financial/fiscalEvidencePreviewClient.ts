import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
export const fiscalEvidencePreviewSchema=z.object({version:z.literal(1),tenant_id:z.string().uuid(),emission_id:z.string().uuid(),observation_id:z.string().uuid(),document_type:z.enum(['cte','nfse']),sha256:z.string().regex(/^[a-f0-9]{64}$/),size_bytes:z.number().int().min(1).max(2_000_000),format:z.string(),identity_matches:z.boolean(),issues:z.array(z.string()),protocol:z.string().nullable(),amount_cents:z.string().regex(/^\d+$/).nullable(),signature_verified:z.literal(false),can_project:z.literal(false),can_receive:z.literal(false)});
export async function readFiscalEvidencePreview(tenant:string,observation:string){
 const {data,error}=await supabase.functions.invoke('finance-fiscal-evidence-preview',{body:{tenant_id:tenant,observation_id:observation},headers:{'x-agvlog-tenant-id':tenant}});
 if(error)throw new Error('Não foi possível consultar o XML existente. O serviço pode estar indisponível ou o arquivo não estar disponível para download.');
 const result=fiscalEvidencePreviewSchema.parse(data);if(result.tenant_id!==tenant||result.observation_id!==observation)throw new Error('Conferência fora do documento ou empresa solicitada.');return result;
}
