// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {secureCleanup} from '../../supabase/functions/secure-upload/secure-cleanup';

const tenant='e1000000-0000-4000-8000-000000000001';
const actor='e1000000-0000-4000-8000-000000000002';
const path=tenant+'/deliveries/e1000000-0000-4000-8000-000000000003/e1000000-0000-4000-8000-000000000004/orphan.png';
const input={tenant,actor,bucket:'receipts',paths:[path],correlationId:'qa-correlation'};
const mocks={authorize:vi.fn(),consumeQuota:vi.fn(),remove:vi.fn()};

beforeEach(()=>{
 vi.clearAllMocks();
 mocks.authorize.mockResolvedValue({data:{version:1,authorized:true,tenant_id:tenant,actor_id:actor,bucket:'receipts',paths:[path]},error:null});
 mocks.consumeQuota.mockResolvedValue(true);mocks.remove.mockResolvedValue({error:null});
});

describe('secure upload orphan cleanup',()=>{
 it('removes only after an exact caller-JWT authorization receipt',async()=>{
  await expect(secureCleanup(input,mocks)).resolves.toEqual({status:200,body:{removed:1,correlation_id:'qa-correlation'}});
  expect(mocks.authorize).toHaveBeenCalledWith({_tenant_id:tenant,_bucket:'receipts',_paths:[path]});
  expect(mocks.authorize.mock.invocationCallOrder[0]).toBeLessThan(mocks.consumeQuota.mock.invocationCallOrder[0]);
  expect(mocks.consumeQuota.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
  expect(mocks.remove).toHaveBeenCalledWith('receipts',[path]);
 });
 it.each([
  {version:1,authorized:true,tenant_id:'other',actor_id:actor,bucket:'receipts',paths:[path]},
  {version:1,authorized:true,tenant_id:tenant,actor_id:'other',bucket:'receipts',paths:[path]},
  {version:1,authorized:true,tenant_id:tenant,actor_id:actor,bucket:'other',paths:[path]},
  {version:1,authorized:true,tenant_id:tenant,actor_id:actor,bucket:'receipts',paths:['changed']},
  null,
 ])('fails closed for a mismatched authorization receipt %#',async data=>{
  mocks.authorize.mockResolvedValue({data,error:null});
  await expect(secureCleanup(input,mocks)).resolves.toMatchObject({status:403});
  expect(mocks.consumeQuota).not.toHaveBeenCalled();expect(mocks.remove).not.toHaveBeenCalled();
 });
 it('treats retained evidence and authorization errors identically without service-role deletion',async()=>{
  mocks.authorize.mockResolvedValue({data:null,error:{code:'23514',message:'storage_evidence_retention_required'}});
  await expect(secureCleanup(input,mocks)).resolves.toEqual({status:403,body:{error:'cleanup_not_authorized_or_evidence_retained',correlation_id:'qa-correlation'}});
  expect(mocks.remove).not.toHaveBeenCalled();
 });
 it('rate limits before Storage and reports an uncertain Storage failure without claiming removal',async()=>{
  mocks.consumeQuota.mockResolvedValueOnce(false);
  await expect(secureCleanup(input,mocks)).resolves.toMatchObject({status:429});expect(mocks.remove).not.toHaveBeenCalled();
  mocks.consumeQuota.mockResolvedValueOnce(true);mocks.remove.mockResolvedValueOnce({error:{message:'lost'}});
  await expect(secureCleanup(input,mocks)).resolves.toMatchObject({status:503});
 });
});
