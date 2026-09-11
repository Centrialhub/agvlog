import {beforeEach,expect,it,vi} from 'vitest';
import {readExpenseArtifacts} from '@/lib/financial/expenseArtifactClient';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
const tenant='11111111-1111-4111-8111-111111111111',expense='22222222-2222-4222-8222-222222222222',intent='33333333-3333-4333-8333-333333333333',artifact='44444444-4444-4444-8444-444444444444',request='55555555-5555-4555-8555-555555555555';
const evidence={version:2,tenant_id:tenant,actor_id:tenant,request_id:request,artifact_id:artifact,source_type:'expense_draft',source_id:intent,state:'sanitized_derivative',usable:true,original:{sha256:'a'.repeat(64),size_bytes:100,format:'jpeg',received:true},issues:[],derivative:{bucket:'upload-validated',path:`${tenant}/${request}/validated.jpg`,sha256:'b'.repeat(64),size_bytes:80,mime:'image/jpeg',method:'jpeg-png-reencode-v1',financial_mapping_required:false}};
const row={link_id:request,artifact_id:artifact,receipt_intent_id:intent,actor_id:tenant,request_id:request,reason:'Comprovante conferido',created_at:'2026-09-11T00:00:00Z',evidence};
const history={version:2,tenant_id:tenant,expense_id:expense,receipts:[row]};
beforeEach(()=>mock.rpc.mockReset());
it('accepts the exact intent consumed by the requested expense history',async()=>{mock.rpc.mockResolvedValue({data:history,error:null});const result=await readExpenseArtifacts(tenant,expense);expect(result.receipts[0].receipt_intent_id).toBe(intent);expect(mock.rpc).toHaveBeenCalledWith('get_finance_expense_receipt_artifacts',{_tenant_id:tenant,_expense_id:expense});});
it('rejects missing or mismatched intent bindings and foreign expense or company',async()=>{
 for(const data of [{...history,expense_id:intent},{...history,tenant_id:intent},{...history,receipts:[{...row,receipt_intent_id:null}]},{...history,receipts:[{...row,receipt_intent_id:expense}]},{...history,receipts:[{...row,evidence:{...evidence,tenant_id:intent}}]}]){mock.rpc.mockResolvedValue({data,error:null});await expect(readExpenseArtifacts(tenant,expense)).rejects.toThrow();}
});
it('keeps legacy expense_item attachments compatible without an intent',async()=>{mock.rpc.mockResolvedValue({data:{...history,receipts:[{...row,receipt_intent_id:undefined,evidence:{...evidence,source_type:'expense_item',source_id:expense}}]},error:null});expect((await readExpenseArtifacts(tenant,expense)).receipts).toHaveLength(1);});
