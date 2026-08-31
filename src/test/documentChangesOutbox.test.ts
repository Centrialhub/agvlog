import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createDocumentChangeOutbox,pendingDocumentChanges} from '@/lib/loads/documentChangesOutbox';
import {isConfirmedDocumentChange,isDocumentChangePayload,type DocumentChangePayload} from '@/lib/loads/documentChanges';
const tenant='20000000-0000-4000-8000-000000000001',load='70000000-0000-4000-8000-000000000001';
const doc='90000000-0000-4000-8000-000000000001',request='a0000000-0000-4000-8000-000000000001';
const payload:DocumentChangePayload={tenant_id:tenant,load_id:load,document_ids:[doc],action:'attach',revision:'a'.repeat(64),reason:'Adicionar',target_stop:{mode:'unassigned'}};
const result={request_id:request,load_id:load,action:'attach',document_ids:[doc],document_count:1,updated:1,added:1,removed:0,load_removed:false,
 target_stop_id:null,retired_stop_ids:[],cancelled_trip_ids:[],totals_recalculated:true};
const send=vi.fn(),changed=vi.fn(),assertContext=vi.fn();
const create=(storage=localStorage)=>createDocumentChangeOutbox({storage,send,changed,assertContext,uuid:()=>request,lock:async(_key,work)=>work()});
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();send.mockResolvedValue({data:result,error:null});});
describe('durable document change requests',()=>{
 it('persists the exact request before sending and confirms every result field',async()=>{
  send.mockImplementation(async()=>{expect(pendingDocumentChanges(localStorage,tenant,'actor')[0].payload).toEqual(payload);return {data:result,error:null};});
  expect(await create().submit(tenant,'actor',payload)).toEqual(result);expect(send).toHaveBeenCalledExactlyOnceWith({...payload,request_id:request});expect(localStorage.length).toBe(0);
 });
 it('recovers the original body after remount without requiring a still-existing load',async()=>{
  send.mockResolvedValueOnce({data:{},error:null});await expect(create().submit(tenant,'actor',payload)).rejects.toThrow('Recuperar');
  const original=send.mock.calls[0][0];await create().recover(tenant,'actor',load);expect(send.mock.calls[1][0]).toEqual(original);expect(localStorage.length).toBe(0);
 });
 it('does not let a new edit overwrite an uncertain earlier commit',async()=>{
  send.mockRejectedValueOnce(new Error('Offline'));await expect(create().submit(tenant,'actor',payload)).rejects.toThrow('Offline');
  await expect(create().submit(tenant,'actor',{...payload,reason:'Novo'})).rejects.toThrow('sem confirmação');expect(send).toHaveBeenCalledTimes(1);
 });
 it.each(['23514','22023','40001','42501'])('clears only a first proven rollback (%s)',async code=>{
  send.mockResolvedValueOnce({data:null,error:{code}});await expect(create().submit(tenant,'actor',payload)).rejects.toMatchObject({code});expect(localStorage.length).toBe(0);
 });
 it.each(['23514','40001','42501'])('keeps an earlier uncertain commit after a later %s rejection',async code=>{
  send.mockResolvedValueOnce({data:null,error:null});await expect(create().submit(tenant,'actor',payload)).rejects.toThrow();
  send.mockResolvedValueOnce({data:null,error:{code}});await expect(create().recover(tenant,'actor',load)).rejects.toMatchObject({code});expect(localStorage.length).toBe(1);
 });
 it.each([{...result,request_id:doc},{...result,load_id:doc},{...result,action:'detach'},{...result,document_ids:[]},
  {...result,document_count:0},{...result,added:0},{...result,load_removed:true},{...result,totals_recalculated:false},null])('retains malformed confirmation %j for recovery',async data=>{
  send.mockResolvedValue({data,error:null});await expect(create().submit(tenant,'actor',payload)).rejects.toThrow('não confirmou');expect(localStorage.length).toBe(1);
 });
 it('does not transmit with corrupt or inaccessible local storage',async()=>{
  localStorage.setItem(`agvlog:documents:v1:${tenant}:actor:${load}`,'bad');await expect(create().submit(tenant,'actor',payload)).rejects.toThrow('recuperação local');
  const storage={getItem:()=>null,setItem:()=>{throw Error('Quota');}} as unknown as Storage;
  await expect(create(storage).submit(tenant,'actor',payload)).rejects.toThrow('recuperação local');expect(send).not.toHaveBeenCalled();
 });
 it('isolates tenant and actor and retains the record on context change during transport',async()=>{
  assertContext.mockImplementationOnce(()=>{}).mockImplementationOnce(()=>{}).mockImplementationOnce(()=>{throw Error('Context changed');});
  await expect(create().submit(tenant,'actor',payload)).rejects.toThrow('Context changed');
  expect(pendingDocumentChanges(localStorage,tenant,'other')).toEqual([]);expect(pendingDocumentChanges(localStorage,'other','actor')).toEqual([]);expect(localStorage.length).toBe(1);
 });
 it('deduplicates immediate repeated submission',async()=>{
  let resolve!:(v:unknown)=>void;send.mockImplementation(()=>new Promise(done=>{resolve=done;}));const outbox=create();
  const first=outbox.submit(tenant,'actor',payload),second=outbox.submit(tenant,'actor',payload);expect(first).toBe(second);resolve({data:result,error:null});await first;expect(send).toHaveBeenCalledTimes(1);
 });
 it('accepts multi-item invoice removal but never an empty or ambiguous removal response',()=>{
  const removal:DocumentChangePayload={...payload,action:'detach',target_stop:null};const response={...result,action:'detach',updated:0,added:0,removed:3,load_removed:true};
  expect(isDocumentChangePayload(removal)).toBe(true);expect(isConfirmedDocumentChange(response,removal,request)).toBe(true);
  expect(isConfirmedDocumentChange({...response,removed:0},removal,request)).toBe(false);expect(isDocumentChangePayload({...payload,target_stop:{}})).toBe(false);
 });
});
