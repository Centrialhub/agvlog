import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
const cents=z.string().regex(/^-?\d+$/),uuid=z.string().uuid();
export const periodEvidenceSchema=z.object({version:z.literal(1),tenant_id:uuid,account_id:uuid,from:z.string(),to:z.string(),revision:z.string(),
 native_source_count:z.number().int().nonnegative(),qualified_source_count:z.number().int().nonnegative(),missing_declared_days:z.number().int().nonnegative(),timezone_count:z.number().int().nonnegative(),
 declaration_status:z.enum(['gaps','timezone_conflict','declared_full_days']),opening_balance_cents:cents.nullable(),closing_balance_cents:cents.nullable(),bank_net_cents:cents,difference_cents:cents.nullable(),
 arithmetic_status:z.enum(['conflicting_anchors','missing_anchors','timezone_conflict','equal','different']),
 anchors:z.array(z.object({import_id:uuid,verification_id:uuid,file_name:z.string(),file_hash:z.string(),day:z.string(),cents,offset_minutes:z.number().int()})),
 coverage_status:z.literal('requires_review'),authenticity_status:z.literal('not_attested'),legacy_integration_status:z.literal('pending'),can_close:z.literal(false)});
export const periodEvidenceCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,account_id:uuid,from:z.string(),to:z.string(),revision:z.string(),reason:z.string().trim().min(5).max(1000)}).strict();
export type PeriodEvidenceCommand=z.infer<typeof periodEvidenceCommandSchema>;
const resultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,review_id:uuid,confirmed:z.literal(true),can_close:z.literal(false)});
async function rpc(name:string,args:Record<string,unknown>){
 const {data,error}=await (supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>)(name,args);
 if(error)throw new Error(error.message);return data;
}
export async function readPeriodEvidence(tenant:string,account:string,from:string,to:string){
 const data=periodEvidenceSchema.parse(await rpc('get_finance_statement_period_evidence',{_tenant_id:tenant,_account_id:account,_from:from,_to:to}));
 if(data.tenant_id!==tenant||data.account_id!==account||data.from!==from||data.to!==to)throw new Error('Evidência fora do período solicitado.');return data;
}
export async function recordPeriodEvidence(command:PeriodEvidenceCommand){
 const parsed=periodEvidenceCommandSchema.parse(command),result=resultSchema.parse(await rpc('record_finance_period_evidence_review',{_payload:parsed}));
 if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id)throw new Error('Revisão fora do contexto solicitado.');return result;
}
