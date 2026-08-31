import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createItemPreparationOutbox,pendingItemPreparations} from '@/lib/loads/itemPreparationOutbox';
import {isConfirmedItemPreparation,isItemPreparationPayload,type ItemPreparationPayload} from '@/lib/loads/itemPreparation';
const tenant='20000000-0000-4000-8000-000000000001',load='70000000-0000-4000-8000-000000000001';
const item='91000000-0000-4000-8000-000000000001',request='a0000000-0000-4000-8000-000000000001';
const payload:ItemPreparationPayload={tenant_id:tenant,load_id:load,item_id:null,values:{item_description:'Manual',quantity:2,pallet_count:1,weight_kg:40},expected:null};
const result={request_id:request,tenant_id:tenant,load_id:load,item_id:item,created:true,totals_recalculated:true,values:payload.values};
const send=vi.fn(),changed=vi.fn(),assertContext=vi.fn();
const create=(storage=localStorage)=>createItemPreparationOutbox({storage,send,changed,assertContext,uuid:()=>request,lock:async(_key,work)=>work()});
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();send.mockResolvedValue({data:result,error:null});});
describe('durable preparation requests',()=>{
 it('persists the body before transport and confirms the exact item and values',async()=>{
  send.mockImplementation(async()=>{expect(pendingItemPreparations(localStorage,tenant,'actor')[0].payload).toEqual(payload);return {data:result,error:null};});
  expect(await create().submit(tenant,'actor',payload)).toEqual(result);expect(send).toHaveBeenCalledExactlyOnceWith({...payload,request_id:request});expect(localStorage.length).toBe(0);
 });
 it('replays the exact request after remount without creating another manual item',async()=>{
  send.mockResolvedValueOnce({data:{},error:null});await expect(create().submit(tenant,'actor',payload)).rejects.toThrow();const original=send.mock.calls[0][0];
  await create().recover(tenant,'actor',load+':new');expect(send.mock.calls[1][0]).toEqual(original);expect(localStorage.length).toBe(0);
 });
 it('will not replace an uncertain earlier request with another item',async()=>{
  send.mockRejectedValueOnce(Error('Offline'));await expect(create().submit(tenant,'actor',payload)).rejects.toThrow('Offline');
  await expect(create().submit(tenant,'actor',{...payload,values:{quantity:3}})).rejects.toThrow('sem confirmação');expect(send).toHaveBeenCalledTimes(1);
 });
 it.each(['23514','22023','40001','42501'])('forgets only a first proven rollback %s',async code=>{
  send.mockResolvedValueOnce({data:null,error:{code}});await expect(create().submit(tenant,'actor',payload)).rejects.toMatchObject({code});expect(localStorage.length).toBe(0);
 });
 it.each(['23514','40001','42501'])('retains an unknown earlier result after a later %s',async code=>{
  send.mockResolvedValueOnce({data:null,error:null});await expect(create().submit(tenant,'actor',payload)).rejects.toThrow();
  send.mockResolvedValueOnce({data:null,error:{code}});await expect(create().recover(tenant,'actor',load+':new')).rejects.toMatchObject({code});expect(localStorage.length).toBe(1);
 });
 it.each([null,{...result,request_id:item},{...result,tenant_id:item},{...result,load_id:item},{...result,item_id:null},
  {...result,created:false},{...result,totals_recalculated:false},{...result,values:{}},{...result,values:{...payload.values,quantity:1}}])('retains an invalid confirmation %j',async data=>{
  send.mockResolvedValueOnce({data,error:null});await expect(create().submit(tenant,'actor',payload)).rejects.toThrow();expect(localStorage.length).toBe(1);
 });
 it('refuses corrupt and unavailable storage before sending',async()=>{
  localStorage.setItem(`agvlog:item-preparation:v1:${tenant}:actor:${load}:new`,'bad');await expect(create().submit(tenant,'actor',payload)).rejects.toThrow('recuperação local');
  await expect(create({getItem:()=>null,setItem:()=>{throw Error('Quota');}} as unknown as Storage).submit(tenant,'actor',payload)).rejects.toThrow('recuperação local');expect(send).not.toHaveBeenCalled();
 });
 it('separates actor/tenant and preserves a request when context changes during transport',async()=>{
  assertContext.mockImplementationOnce(()=>{}).mockImplementationOnce(()=>{}).mockImplementationOnce(()=>{throw Error('Context changed');});
  await expect(create().submit(tenant,'actor',payload)).rejects.toThrow('Context changed');
  expect(pendingItemPreparations(localStorage,tenant,'other')).toEqual([]);expect(pendingItemPreparations(localStorage,'other','actor')).toEqual([]);expect(localStorage.length).toBe(1);
 });
 it('deduplicates simultaneous submission within the same controller',async()=>{
  let resolve!:(v:unknown)=>void;send.mockImplementation(()=>new Promise(done=>{resolve=done;}));const outbox=create();
  const first=outbox.submit(tenant,'actor',payload),second=outbox.submit(tenant,'actor',payload);expect(first).toBe(second);resolve({data:result,error:null});await first;expect(send).toHaveBeenCalledTimes(1);
 });
 it('requires expected values for every edited field and checks the existing item ID',()=>{
  const update:ItemPreparationPayload={...payload,item_id:item,values:{status:'loaded'},expected:{status:'pending'}};
  expect(isItemPreparationPayload(update)).toBe(true);expect(isItemPreparationPayload({...update,expected:{}})).toBe(false);
  expect(isConfirmedItemPreparation({...result,created:false,values:{status:'loaded'}},update,request)).toBe(true);
  expect(isConfirmedItemPreparation({...result,item_id:request,created:false,values:{status:'loaded'}},update,request)).toBe(false);
 });
 it.each([{quantity:-1},{quantity:Infinity},{quantity:NaN},{pallet_count:1.5},{pallet_count:2147483648},{status:'delivered'},{fiscal_document_id:item}])('rejects invalid fields %j before persistence',async values=>{
  await expect(create().submit(tenant,'actor',{...payload,values} as ItemPreparationPayload)).rejects.toThrow();expect(send).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
 });
});
