import {it,expect,vi} from 'vitest';
import {previewExpenseArtifact} from '../../supabase/functions/secure-upload/artifact-preview';
const tenant='tenant',expense='expense',artifact='artifact';
const data={version:2,tenant_id:tenant,artifact_id:artifact,source_type:'expense_item',source_id:expense,request_id:'request',state:'sanitized_derivative',usable:true,derivative:{bucket:'upload-validated',path:'tenant/request/validated.jpg',method:'jpeg-png-reencode-v1',mime:'image/jpeg',sha256:'a'.repeat(64)}};
it('authorizes only the selected expense derivative and never signs the original',async()=>{
 const sign=vi.fn(async()=>({data:{signedUrl:'https://storage.example/validated.jpg'},error:null}));
 await previewExpenseArtifact(tenant,expense,artifact,{read:async()=>({data,error:null}),sign});expect(sign).toHaveBeenCalledWith('upload-validated','tenant/request/validated.jpg');
});
it('denies quarantined evidence, another expense and a forged original bucket before signing',async()=>{
 for(const modified of [{...data,state:'quarantined',usable:false},{...data,source_id:'another'},{...data,derivative:{...data.derivative,bucket:'upload-quarantine'}}]){
  const sign=vi.fn();await expect(previewExpenseArtifact(tenant,expense,artifact,{read:async()=>({data:modified,error:null}),sign})).rejects.toThrow('unavailable');expect(sign).not.toHaveBeenCalled();
 }
});
