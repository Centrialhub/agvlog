import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
import {uploadFinanceArtifact} from '@/lib/financial/uploadArtifactClient';

beforeEach(()=>mocks.invoke.mockReset());
it('sends the selected workbook sheet to secure-upload and validates the bound artifact response',async()=>{
 const tenant=crypto.randomUUID(),actor=crypto.randomUUID(),request=crypto.randomUUID(),account=crypto.randomUUID(),artifact=crypto.randomUUID();
 const source=new Uint8Array([0x50,0x4b,0x03,0x04,1,2,3]),file=new File([source],'extrato.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',source)),byte=>byte.toString(16).padStart(2,'0')).join('');
 mocks.invoke.mockResolvedValue({error:null,data:{version:2,tenant_id:tenant,actor_id:actor,request_id:request,artifact_id:artifact,source_type:'bank_account',source_id:account,state:'validated_data',usable:true,issues:[],
  original:{sha256:hash,size_bytes:file.size,format:'xlsx',received:true},derivative:{bucket:'upload-validated',path:`${tenant}/${request}/validated.json`,sha256:'b'.repeat(64),size_bytes:20,mime:'application/json',method:'strict-workbook-matrix-v1',financial_mapping_required:true}}});
 await uploadFinanceArtifact({tenantId:tenant,actorId:actor,requestId:request,sourceType:'bank_account',sourceId:account,file,format:'xlsx',sheetIndex:3});
 expect(mocks.invoke).toHaveBeenCalledTimes(1);const [name,options]=mocks.invoke.mock.calls[0] as [string,{body:FormData}];
 expect(name).toBe('secure-upload');expect(options.body.get('format')).toBe('xlsx');expect(options.body.get('sheet_index')).toBe('3');expect(options.body.get('delimiter')).toBeNull();
});
