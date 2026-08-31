import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createDispatchOutbox,pendingDispatches,type DispatchWirePayload} from '@/lib/route-planning/dispatchOutbox';

const trip='80000000-0000-4000-8000-000000000001';const request='a0000000-0000-4000-8000-000000000001';
const payload:DispatchWirePayload={tenant_id:'tenant',driver_id:'driver',vehicle_id:'vehicle',planned_start_at:'2030-01-01T10:00:00Z',
  route_name:'Route',load_ids:['load'],stops:[{destination:'Client',fiscal_document_ids:['doc']}],planning_draft_id:'draft'};
const make=(send=vi.fn().mockResolvedValue({data:trip,error:null}),storage:Storage=localStorage)=>{
  const uuid=vi.fn(()=>request);const outbox=createDispatchOutbox({storage,send,uuid,lock:async(_key,work)=>work()});
  return {outbox,send,uuid,dispatch:()=>outbox.dispatch('tenant','actor','scope',payload),recover:()=>outbox.recover('tenant','actor','scope')};
};
beforeEach(()=>localStorage.clear());
describe('durable planning outbox',()=>{
  it('persists before sending and removes only the confirmed request',async()=>{
    const send=vi.fn(async()=>{expect(pendingDispatches(localStorage,'tenant','actor')).toHaveLength(1);return {data:trip,error:null};});
    const test=make(send);expect(await test.dispatch()).toBe(trip);expect(localStorage.length).toBe(0);
    expect(send).toHaveBeenCalledWith({...payload,idempotency_key:request});
  });
  it('deduplicates overlapping clicks inside one coordinator',async()=>{
    let release!:(value:unknown)=>void;const response=new Promise(resolve=>{release=resolve;});const test=make(vi.fn(()=>response));
    const first=test.dispatch();const second=test.dispatch();release({data:trip,error:null});
    expect(await Promise.all([first,second])).toEqual([trip,trip]);expect(test.send).toHaveBeenCalledTimes(1);
  });
  it.each([null,{},'',42,'not-a-uuid'])('keeps request for malformed success %j',async data=>{
    const test=make(vi.fn().mockResolvedValue({data,error:null}));await expect(test.dispatch()).rejects.toThrow('não confirmou');
    expect(pendingDispatches(localStorage,'tenant','actor')[0].requestId).toBe(request);
  });
  it('freezes payload across network loss, reload, edits and explicit recovery',async()=>{
    const input=structuredClone(payload);const first=make(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(first.outbox.dispatch('tenant','actor','scope',input)).rejects.toThrow('fetch');input.route_name='Edited';
    const reload=make();await expect(reload.outbox.dispatch('tenant','actor','scope',input)).rejects.toMatchObject({code:'DISPATCH_PENDING'});
    expect(reload.send).not.toHaveBeenCalled();expect(await reload.recover()).toBe(trip);
    expect(reload.send).toHaveBeenCalledWith({...payload,idempotency_key:request});expect(reload.uuid).not.toHaveBeenCalled();
  });
  it.each(['23514','42501','40001','40P01','22023'])('releases first definite SQL rejection %s for correction',async code=>{
    const test=make(vi.fn().mockResolvedValue({data:null,error:{code,message:'Rejected'}}));
    await expect(test.dispatch()).rejects.toMatchObject({code});expect(localStorage.length).toBe(0);
  });
  it.each(['42501','23514','40003','PGRST000'])('never clears unknown prior commit after later rejection %s',async code=>{
    const test=make(vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({data:null,error:{code,message:'Rejected'}}));
    await expect(test.dispatch()).rejects.toThrow('Offline');await expect(test.recover()).rejects.toMatchObject({code});
    expect(localStorage.length).toBe(1);
  });
  it('treats SQL statement-completion-unknown as ambiguous on the first request',async()=>{
    const test=make(vi.fn().mockResolvedValue({data:null,error:{code:'40003',message:'unknown'}}));
    await expect(test.dispatch()).rejects.toThrow('unknown');expect(localStorage.length).toBe(1);
  });
  it('does not cross tenant or actor boundaries',async()=>{
    const first=make(vi.fn().mockRejectedValue(new Error('Offline')));await expect(first.dispatch()).rejects.toThrow();
    expect(pendingDispatches(localStorage,'tenant','another-actor')).toEqual([]);
    expect(pendingDispatches(localStorage,'another-tenant','actor')).toEqual([]);
    await expect(make().outbox.recover('tenant','another-actor','scope')).rejects.toThrow('Não há despacho');
  });
  it('fails closed on corrupt storage without discarding the pending request',async()=>{
    localStorage.setItem('agvlog:dispatch:v1:tenant:actor:scope','{corrupt');const test=make();
    await expect(test.dispatch()).rejects.toThrow('armazenamento');expect(test.send).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);
  });
  it('does not send if durable storage is blocked or full',async()=>{
    const storage={getItem:()=>null,setItem:()=>{throw new Error('quota');}} as unknown as Storage;const test=make(undefined,storage);
    await expect(test.dispatch()).rejects.toThrow('armazenamento');expect(test.send).not.toHaveBeenCalled();
  });
  it('retains a replayable request when cleanup fails after confirmed success',async()=>{
    const test=make();const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw new Error('blocked');});
    try{expect(await test.dispatch()).toBe(trip);expect(localStorage.length).toBe(1);}finally{remove.mockRestore();}
    expect(await test.recover()).toBe(trip);expect(localStorage.length).toBe(0);
  });
});
