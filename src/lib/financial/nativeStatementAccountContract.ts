import {z} from 'zod';
const uuid=z.string().uuid();
export const nativeStatementAccountSchema=z.object({version:z.literal(1),tenant_id:uuid,import_id:uuid,bank_account_id:uuid,account_name:z.string(),
 status:z.enum(['matched_exact','mismatch','incomplete','source_unverified','unsupported_format','ambiguous']),method:z.literal('ofx_exact_v1'),source_verification_id:uuid.nullable(),matching_account_count:z.number().int().nonnegative(),
 revision:z.string().regex(/^[a-f0-9]{32}$/),coverage_verification:z.literal('pending'),checks:z.array(z.object({
  field:z.enum(['bank_code','branch_number','account_number','account_type']),file_value:z.string().nullable(),registered_value:z.string().nullable(),status:z.enum(['matched','missing','different']),
 }))}).superRefine((data,ctx)=>{
 if(data.status==='matched_exact'&&(data.matching_account_count!==1||!data.source_verification_id||data.checks.length!==4||new Set(data.checks.map(row=>row.field)).size!==4||data.checks.some(row=>row.status!=='matched'||!row.file_value||row.file_value!==row.registered_value)))
  ctx.addIssue({code:z.ZodIssueCode.custom,message:'Correspondência da conta sem evidências completas.'});
});
export const nativeAccountLabels={matched_exact:'Dados do OFX correspondem ao cadastro',mismatch:'Identificação da conta divergente',incomplete:'Identificação incompleta',source_unverified:'Original ainda não confirmado',unsupported_format:'Formato sem identificação nativa suportada',ambiguous:'Mais de uma conta cadastrada possui esta identificação'};
export const nativeAccountFields={bank_code:'Código do banco',branch_number:'Agência',account_number:'Conta',account_type:'Tipo de conta'};
