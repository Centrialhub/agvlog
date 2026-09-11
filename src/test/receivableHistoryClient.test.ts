import {beforeEach,describe,it,expect,vi} from 'vitest';
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
import {readReceivableHistory,ReceivableHistoryChangedError} from '@/lib/financial/receivableHistoryClient';
import {receivableHistoryFixture,historyIds} from './helpers/receivableHistoryFixture';
const request={tenantId:historyIds.tenant,receivableId:null,page:1,expectedRevision:null};
beforeEach(()=>{rpc.mockReset();});
describe('captured history client',()=>{
 it('passes exact scope and validates the returned history',async()=>{
  const data=receivableHistoryFixture();rpc.mockResolvedValue({data,error:null});
  expect(await readReceivableHistory(request)).toEqual(data);
  expect(rpc).toHaveBeenCalledWith('get_finance_receivable_history',{_tenant_id:historyIds.tenant,_receivable_id:null,_page:1,_expected_revision:null});
 });
 it('rejects another title filter, tenant or page even for valid response shapes',async()=>{
  for(const patch of [{tenant_id:historyIds.actor,rows:[],total:0},{receivable_id:historyIds.title},{page:2,rows:[],total:0}]){
   rpc.mockResolvedValue({data:{...receivableHistoryFixture(),...patch},error:null});
   await expect(readReceivableHistory(request)).rejects.toThrow('fora da empresa');
  }
 });
 it('distinguishes revision changes from denied access and transport errors',async()=>{
  rpc.mockResolvedValue({data:null,error:{code:'40001',message:'history_changed'}});
  await expect(readReceivableHistory(request)).rejects.toBeInstanceOf(ReceivableHistoryChangedError);
  for(const error of [{code:'42501',message:'denied'},new Error('network')]){
   rpc.mockResolvedValue({data:null,error});await expect(readReceivableHistory(request)).rejects.toBe(error);
  }
 });
 it('rejects a changed revision even if the server returns success',async()=>{
  rpc.mockResolvedValue({data:receivableHistoryFixture(),error:null});
  await expect(readReceivableHistory({...request,expectedRevision:'b'.repeat(32)})).rejects.toBeInstanceOf(ReceivableHistoryChangedError);
 });
 it('never sends invalid pagination without a revision',async()=>{
  await expect(readReceivableHistory({...request,page:2})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();
 });
});
