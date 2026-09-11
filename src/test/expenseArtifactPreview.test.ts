import {it,expect,vi} from 'vitest';
import {previewExpenseArtifact} from '../../supabase/functions/secure-upload/artifact-preview';
const tenant='tenant',expense='expense',artifact='artifact';
const data={version:2,tenant_id:tenant,artifact_id:artifact,source_type:'expense_item',source_id:expense,request_id:'request',state:'sanitized_derivative',usable:true,derivative:{bucket:'upload-validated',path:'tenant/request/validated.jpg',method:'jpeg-png-reencode-v1',mime:'image/jpeg',sha256:'a'.repeat(64)}};
const history=(evidence:typeof data,receipt_intent_id:string|null=null)=>({version:2,tenant_id:tenant,expense_id:expense,receipts:[{artifact_id:artifact,receipt_intent_id,evidence}]});
it('authorizes only the selected expense derivative and never signs the original',async()=>{
 const sign=vi.fn(async()=>({data:{signedUrl:'https://storage.example/validated.jpg'},error:null}));
 await previewExpenseArtifact(tenant,expense,artifact,{read:async()=>({data:history(data),error:null}),sign});expect(sign).toHaveBeenCalledWith('upload-validated','tenant/request/validated.jpg');
});
it('denies quarantined evidence, another expense and a forged original bucket before signing',async()=>{
 for(const modified of [{...data,state:'quarantined',usable:false},{...data,source_id:'another'},{...data,derivative:{...data.derivative,bucket:'upload-quarantine'}}]){
  const sign=vi.fn();await expect(previewExpenseArtifact(tenant,expense,artifact,{read:async()=>({data:history(modified),error:null}),sign})).rejects.toThrow('unavailable');expect(sign).not.toHaveBeenCalled();
 }
});

it('signs only a prepared artifact whose exact consumption is present in the authorized expense history',async()=>{
 const prepared={...data,source_type:'expense_draft',source_id:'intent'};
 const sign=vi.fn(async()=>({data:{signedUrl:'https://storage.example/validated.jpg'},error:null}));
 await previewExpenseArtifact(tenant,expense,artifact,{read:async()=>({data:history(prepared,'intent'),error:null}),sign});expect(sign).toHaveBeenCalledTimes(1);
 for(const invalid of [prepared,history(prepared),history(prepared,'another'),{...history(prepared,'intent'),expense_id:'another'}, {...history(prepared,'intent'),receipts:[]}, {...history(prepared,'intent'),receipts:[...history(prepared,'intent').receipts,...history(prepared,'intent').receipts]}]){
  sign.mockClear();await expect(previewExpenseArtifact(tenant,expense,artifact,{read:async()=>({data:invalid,error:null}),sign})).rejects.toThrow('unavailable');expect(sign).not.toHaveBeenCalled();
 }
});
