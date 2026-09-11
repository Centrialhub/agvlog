import {z} from 'zod';
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const uploadArtifactSchema=z.object({
 version:z.literal(2),tenant_id:uuid,actor_id:uuid,request_id:uuid,artifact_id:uuid,
 source_type:z.enum(['trip','settlement','bank_account','expense_item']),source_id:uuid,
 state:z.enum(['quarantined','validated_data','sanitized_derivative','rejected','validation_failed']),
 original:z.object({sha256:hash,size_bytes:z.number().int().positive().max(10485760),format:z.enum(['ofx','csv','jpeg','png','pdf','xls','xlsx','unknown']),received:z.boolean()}),
 usable:z.boolean(),issues:z.array(z.string()),
 derivative:z.object({bucket:z.literal('upload-validated'),path:z.string(),sha256:hash,size_bytes:z.number().int().positive().max(20971520),mime:z.enum(['application/json','image/jpeg','image/png']),method:z.enum(['native-ofx-v1','strict-csv-matrix-v1','jpeg-png-reencode-v1']),financial_mapping_required:z.boolean()}).nullable(),
}).superRefine((d,c)=>{
 const usable=['validated_data','sanitized_derivative'].includes(d.state);
 if(d.usable!==usable||usable&&(!d.original.received||!d.derivative)||!usable&&d.derivative!==null)c.addIssue({code:'custom',message:'Estado de validação inconsistente.'});
 if(d.derivative){
  const ext=d.derivative.mime==='application/json'?'json':d.derivative.mime==='image/jpeg'?'jpg':'png';
  if(d.derivative.path!==`${d.tenant_id}/${d.request_id}/validated.${ext}`)c.addIssue({code:'custom',message:'Destino do derivado inconsistente.'});
  const valid=d.state==='validated_data'?
   d.derivative.mime==='application/json'&&((d.original.format==='ofx'&&d.derivative.method==='native-ofx-v1'&&!d.derivative.financial_mapping_required)||(d.original.format==='csv'&&d.derivative.method==='strict-csv-matrix-v1'&&d.derivative.financial_mapping_required)):
   d.derivative.method==='jpeg-png-reencode-v1'&&!d.derivative.financial_mapping_required&&((d.original.format==='jpeg'&&d.derivative.mime==='image/jpeg')||(d.original.format==='png'&&d.derivative.mime==='image/png'));
  if(!valid)c.addIssue({code:'custom',message:'Método incompatível com o formato.'});
 }
});
export type UploadArtifact=z.infer<typeof uploadArtifactSchema>;
export function uploadArtifactStatus(a:UploadArtifact):string{
 if(a.state==='quarantined'){
  const issue=a.issues?.[0],labels:Record<string,string>={image_pixel_limit:'A imagem excede o limite de dimensões; envie uma versão menor.',image_size_limit:'A imagem deve ter até 5 MB.',image_processing_budget:'A imagem excedeu o tempo de processamento; envie uma versão menor.',image_validation_failed:'A imagem não pôde ser reprocessada dentro dos limites; envie uma versão menor em JPEG ou PNG.',image_animation_not_supported:'Imagens animadas não são aceitas.',image_processing_unavailable:'O reprocessamento de imagens ainda não estava disponível neste envio.',format_requires_sanitization:'Este formato ainda depende de processamento seguro antes de uso.'};
  return 'Original recebido em quarentena. Ainda não está disponível como comprovante ou extrato analisado.'+(issue&&labels[issue]?' '+labels[issue]:'');
 }
 if(a.state==='rejected')return 'Original preservado em quarentena. O arquivo não passou pela validação de formato.';
 if(a.state==='validation_failed')return 'Original preservado em quarentena. A validação não foi concluída.';
 if(a.state==='sanitized_derivative')return 'Cópia da imagem reprocessada disponível; o original permanece privado.';
 return a.derivative?.financial_mapping_required?'Dados CSV validados. Ainda é necessário mapear as colunas e conferir a conta e os valores.':'Dados OFX validados. A importação e a conferência financeira ainda precisam ser concluídas.';
}
