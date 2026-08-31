import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createReplanningOutbox,pendingReplannings} from '@/lib/loads/replanningOutbox';
import {isConfirmedReplanning,isReplanningPayload,type ReplanningPayload} from '@/lib/loads/replanning';
const source='70000000-0000-4000-8000-000000000001',target='70000000-0000-4000-8000-000000000002';
const item='91000000-0000-4000-8000-000000000001',doc='90000000-0000-4000-8000-000000000001';
const request='a0000000-0000-4000-8000-000000000001',stop='82000000-0000-4000-8000-000000000001';
const payload:ReplanningPayload={tenant_id:'tenant',source_load_id:source,target_load_id:target,item_ids:[item],expected_document_ids:[doc],
  revision:'a'.repeat(64),reason:'Reorganizar rota',target_stop:{mode:'existing',stop_id:stop}};
const result={request_id:request,moved:1,source_load_id:source,target_load_id:target,document_ids:[doc],target_stop_id:stop,
  source_removed:true,retired_stop_ids:[],cancelled_trip_ids:[]};
const scope=`${source}:${target}`;
const send=vi.fn();const changed=vi.fn();const assertContext=vi.fn();
const create=(storage=localStorage)=>createReplanningOutbox({storage,send,changed,assertContext,uuid:()=>request,lock:async(_key,work)=>work()});
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();send.mockResolvedValue({data:result,error:null});});
describe('durable explicit replanning',()=>{
  it('persists the exact authorized body before transport and removes it only after a matching confirmation',async()=>{
    send.mockImplementation(async()=>{expect(pendingReplannings(localStorage,'tenant','actor')[0].payload).toEqual(payload);return {data:result,error:null};});
    expect(await create().submit('tenant','actor',payload)).toEqual(result);
    expect(send).toHaveBeenCalledExactlyOnceWith({...payload,request_id:request});expect(localStorage.length).toBe(0);
  });
  it('survives reload and explicitly replays the frozen body/key after an uncertain response',async()=>{
    send.mockResolvedValueOnce({data:null,error:null});await expect(create().submit('tenant','actor',payload)).rejects.toThrow('Recuperar');
    const original=send.mock.calls[0][0];expect(pendingReplannings(localStorage,'tenant','actor')).toHaveLength(1);
    expect(await create().recover('tenant','actor',scope)).toEqual(result);expect(send.mock.calls[1][0]).toEqual(original);
    expect(localStorage.length).toBe(0);
  });
  it('refuses replacing an uncertain request with new user edits',async()=>{
    send.mockRejectedValueOnce(new Error('Offline'));await expect(create().submit('tenant','actor',payload)).rejects.toThrow('Offline');
    await expect(create().submit('tenant','actor',{...payload,reason:'Outra rota'})).rejects.toThrow('sem confirmação');
    expect(send).toHaveBeenCalledTimes(1);expect(pendingReplannings(localStorage,'tenant','actor')[0].payload.reason).toBe(payload.reason);
  });
  it.each(['40001','23514','22023','42501'])('releases the first definitely rolled-back request (%s)',async code=>{
    send.mockResolvedValueOnce({data:null,error:{code,message:'Rejected'}});await expect(create().submit('tenant','actor',payload)).rejects.toMatchObject({code});
    expect(localStorage.length).toBe(0);expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(['40001','23514','42501'])('retains an earlier unknown commit after a later %s rejection',async code=>{
    send.mockResolvedValueOnce({data:{},error:null});await expect(create().submit('tenant','actor',payload)).rejects.toThrow();
    send.mockResolvedValueOnce({data:null,error:{code,message:'Rejected'}});await expect(create().recover('tenant','actor',scope)).rejects.toMatchObject({code});
    expect(localStorage.length).toBe(1);
  });
  it('does not misclassify statement completion unknown as a rollback',async()=>{
    send.mockResolvedValue({data:null,error:{code:'40003'}});await expect(create().submit('tenant','actor',payload)).rejects.toMatchObject({code:'40003'});
    expect(localStorage.length).toBe(1);
  });
  it.each([{...result,moved:0},{...result,request_id:stop},{...result,target_stop_id:target},{...result,document_ids:[]},
    {...result,source_removed:undefined},{...result,retired_stop_ids:['invalid']},null])('rejects malformed/mismatched confirmation %j',async data=>{
    send.mockResolvedValue({data,error:null});await expect(create().submit('tenant','actor',payload)).rejects.toThrow('não confirmou');
    expect(localStorage.length).toBe(1);expect(send).toHaveBeenCalledTimes(1);
  });
  it('scopes pending requests to the tenant and actor',async()=>{
    send.mockRejectedValue(new Error('Offline'));await expect(create().submit('tenant','actor',payload)).rejects.toThrow();
    expect(pendingReplannings(localStorage,'other','actor')).toEqual([]);expect(pendingReplannings(localStorage,'tenant','other')).toEqual([]);
    await expect(create().recover('tenant','other',scope)).rejects.toThrow('solicitação válida');expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not send when storage is unavailable or corrupt',async()=>{
    const storage={getItem:()=>null,setItem:()=>{throw new Error('Quota');}} as unknown as Storage;
    await expect(create(storage).submit('tenant','actor',payload)).rejects.toThrow('recuperação local');expect(send).not.toHaveBeenCalled();
    localStorage.setItem(`agvlog:replanning:v1:tenant:actor:${scope}`,'not JSON');
    await expect(create().submit('tenant','actor',payload)).rejects.toThrow('recuperação local');expect(send).not.toHaveBeenCalled();
  });
  it('leaves the original request replayable when local cleanup fails after commit',async()=>{
    const storage={getItem:(key:string)=>localStorage.getItem(key),setItem:(key:string,value:string)=>localStorage.setItem(key,value),
      removeItem:()=>{throw new Error('Blocked');}} as unknown as Storage;
    expect(await create(storage).submit('tenant','actor',payload)).toEqual(result);expect(localStorage.length).toBe(1);
    expect(await create().recover('tenant','actor',scope)).toEqual(result);expect(localStorage.length).toBe(0);
  });
  it('rejects a session change after a server response without dropping its recovery record',async()=>{
    assertContext.mockImplementationOnce(()=>{}).mockImplementationOnce(()=>{}).mockImplementationOnce(()=>{throw new Error('Context changed');});
    await expect(create().submit('tenant','actor',payload)).rejects.toThrow('Context changed');expect(localStorage.length).toBe(1);
  });
  it('deduplicates a synchronous double submit without relying only on React rendering',async()=>{
    let resolve!:(value:unknown)=>void;send.mockImplementation(()=>new Promise(done=>{resolve=done;}));const outbox=create();
    const first=outbox.submit('tenant','actor',payload),second=outbox.submit('tenant','actor',payload);
    expect(first).toBe(second);resolve({data:result,error:null});await first;expect(send).toHaveBeenCalledTimes(1);
  });
  it('validates explicit new destinations and does not accept guessed/blank coordinates',()=>{
    expect(isReplanningPayload({...payload,target_stop:{mode:'new',destination:'Destino',latitude:0,longitude:0,client_id:null}})).toBe(true);
    expect(isReplanningPayload({...payload,target_stop:{mode:'new',destination:'Destino',latitude:NaN,longitude:0,client_id:null}})).toBe(false);
    expect(isConfirmedReplanning({...result,target_stop_id:null},{...payload,target_stop:{mode:'unassigned'}},request)).toBe(true);
  });
});
