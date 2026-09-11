import {describe,it,expect} from 'vitest';
import {uploadArtifactSchema,uploadArtifactStatus} from '@/lib/financial/uploadArtifactContract';
const id='11111111-1111-4111-8111-111111111111';
const base={version:2,tenant_id:id,actor_id:id,request_id:id,artifact_id:id,source_type:'bank_account',source_id:id,state:'quarantined',original:{sha256:'a'.repeat(64),size_bytes:10,format:'pdf',received:true},usable:false,derivative:null,issues:['format_requires_sanitization']};
describe('upload artifact',()=>{
 it('quarantined PDF stays visibly unavailable and never yields a legacy receipt path',()=>{
  const dto=uploadArtifactSchema.parse(base);expect(uploadArtifactStatus(dto)).toContain('Ainda não está disponível');expect(dto.derivative).toBeNull();
 });
 it('rejects a quarantine response claiming usability',()=>{
  expect(uploadArtifactSchema.safeParse({...base,usable:true}).success).toBe(false);
 });
 it('validates format, mapping and tenant-scoped derived path together',()=>{
  const dto={...base,state:'validated_data',usable:true,original:{...base.original,format:'csv'},derivative:{bucket:'upload-validated',path:`${id}/${id}/validated.json`,sha256:'b'.repeat(64),size_bytes:30,mime:'application/json',method:'strict-csv-matrix-v1',financial_mapping_required:true}};
  expect(uploadArtifactStatus(uploadArtifactSchema.parse(dto))).toContain('mapear as colunas');
  expect(uploadArtifactSchema.safeParse({...dto,derivative:{...dto.derivative,financial_mapping_required:false}}).success).toBe(false);
  expect(uploadArtifactSchema.safeParse({...dto,derivative:{...dto.derivative,path:'other/validated.json'}}).success).toBe(false);
 });
});
