import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createRedeliveryOutbox,pendingRedeliveries} from '@/lib/loads/redeliveryOutbox';
import {isConfirmedRedelivery,isRedeliveryPayload,type RedeliveryExpected,type RedeliveryPayload} from '@/lib/loads/redelivery';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),actor=id(2),request=id(3),doc=id(4);
const expected:RedeliveryExpected={loadId:id(5),tripId:id(6),stopId:id(7),outcomeId:id(8)};
const payload=():RedeliveryPayload=>({tenant_id:tenant,document_id:doc,revision:'a'.repeat(64),reason:'Saldo físico conferido QA',
 items:[{source_item_id:id(9),item_description:'Produto QA',pallet_count:1,weight_kg:2,volume_m3:0.2}]});
const result=()=>({request_id:request,tenant_id:tenant,actor_id:actor,document_id:doc,attempt_id:id(10),event_id:id(11),
 source_load_id:expected.loadId,source_trip_id:expected.tripId,source_stop_id:expected.stopId,previous_outcome_id:expected.outcomeId,
 status:'confirmed',load_id:null,item_count:1,historical_allocation_preserved:true,financial_values_preserved:true});
const deps=()=>({storage:localStorage,uuid:()=>request,changed:vi.fn(),assertContext:vi.fn(),
 lock:async<T>(_key:string,work:()=>Promise<T>)=>work(),send:vi.fn(async()=>({data:result() as unknown,error:null as unknown}))});
beforeEach(()=>localStorage.clear());
describe('durable, actor-scoped redelivery outbox',()=>{
 it('persists the exact envelope before sending and removes only a matching acknowledgement',async()=>{
  const d=deps();d.send.mockImplementationOnce(async()=>{
   expect(pendingRedeliveries(localStorage,tenant,actor)[0]).toMatchObject({version:1,requestId:request,payload:payload(),expected});
   return {data:result(),error:null};
  });
  await createRedeliveryOutbox(d).submit(tenant,actor,payload(),expected);expect(localStorage.length).toBe(0);
 });
 it('retains uncertain transport and replays the same payload after reconstructing the client',async()=>{
  const d=deps();d.send.mockRejectedValueOnce(new Error('Offline'));
  await expect(createRedeliveryOutbox(d).submit(tenant,actor,payload(),expected)).rejects.toThrow('Offline');
  await createRedeliveryOutbox(d).recover(tenant,actor,doc);
  expect(d.send.mock.calls[1]).toEqual(d.send.mock.calls[0]);expect(localStorage.length).toBe(0);
 });
 it.each(['22023','23514','40001','40P01','55P03','42501'])('discards a first confirmed SQL rejection %s',async code=>{
  const d=deps();d.send.mockResolvedValueOnce({data:null,error:{code,message:'Confirmed rejection'}});
  await expect(createRedeliveryOutbox(d).submit(tenant,actor,payload(),expected)).rejects.toMatchObject({code});expect(localStorage.length).toBe(0);
 });
 it.each(['22023','23514','40001','42501','55000','PGRST202'])('retains a pending request after recovery rejection %s',async code=>{
  const d=deps();d.send.mockRejectedValueOnce(new Error('Offline'));const outbox=createRedeliveryOutbox(d);
  await expect(outbox.submit(tenant,actor,payload(),expected)).rejects.toThrow('Offline');
  d.send.mockResolvedValueOnce({data:null,error:{code,message:'Recovery rejected'}});
  await expect(outbox.recover(tenant,actor,doc)).rejects.toMatchObject({code});expect(localStorage.length).toBe(1);
 });
 it.each(['actor_id','document_id','source_load_id','source_trip_id','source_stop_id','previous_outcome_id','request_id'])('does not accept mismatched %s',async key=>{
  const d=deps();d.send.mockResolvedValueOnce({data:{...result(),[key]:id(99)},error:null});
  await expect(createRedeliveryOutbox(d).submit(tenant,actor,payload(),expected)).rejects.toThrow('O servidor não confirmou');expect(localStorage.length).toBe(1);
 });
 it('blocks a new request while the same document has an uncertain outcome',async()=>{
  const d=deps();d.send.mockRejectedValueOnce(new Error('Offline'));const outbox=createRedeliveryOutbox(d);
  await expect(outbox.submit(tenant,actor,payload(),expected)).rejects.toThrow('Offline');
  await expect(outbox.submit(tenant,actor,{...payload(),reason:'Outro motivo'},expected)).rejects.toThrow('Há reentrega sem confirmação');expect(d.send).toHaveBeenCalledTimes(1);
 });
 it('does not read or recover another tenant or actor envelope',async()=>{
  const d=deps();d.send.mockRejectedValueOnce(new Error('Offline'));const outbox=createRedeliveryOutbox(d);
  await expect(outbox.submit(tenant,actor,payload(),expected)).rejects.toThrow('Offline');
  expect(pendingRedeliveries(localStorage,tenant,id(99))).toEqual([]);expect(pendingRedeliveries(localStorage,id(99),actor)).toEqual([]);
  await expect(outbox.recover(tenant,id(99),doc)).rejects.toThrow();expect(d.send).toHaveBeenCalledTimes(1);
 });
 it('blocks corrupt or incompatible envelopes without silently deleting them',()=>{
  localStorage.setItem(`agvlog:redelivery:v1:${tenant}:${actor}:${doc}`,JSON.stringify({version:2}));
  expect(()=>pendingRedeliveries(localStorage,tenant,actor)).toThrow('incompatível');expect(localStorage.length).toBe(1);
 });
 it('refuses a newer envelope version for this actor instead of resubmitting after an app rollback',async()=>{
  localStorage.setItem(`agvlog:redelivery:v2:${tenant}:${actor}:${doc}`,JSON.stringify({version:2}));
  const d=deps();await expect(createRedeliveryOutbox(d).submit(tenant,actor,payload(),expected)).rejects.toThrow('incompatível');
  expect(d.send).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);
 });
 it('retains acknowledgement uncertainty when the session changes during transport',async()=>{
  const d=deps();d.send.mockImplementationOnce(async()=>{d.assertContext.mockImplementation(()=>{throw new Error('Session changed');});return {data:result(),error:null};});
  await expect(createRedeliveryOutbox(d).submit(tenant,actor,payload(),expected)).rejects.toThrow('Session changed');expect(localStorage.length).toBe(1);
 });
 it('validates required expected anchors and refuses unknown fields/quantities',async()=>{
  expect(isRedeliveryPayload({...payload(),items:[{...payload().items[0],quantity:100}]})).toBe(false);
  expect(isConfirmedRedelivery({...result(),financial_values_preserved:false},payload(),expected,actor,request)).toBe(false);
  const d=deps();await expect(createRedeliveryOutbox(d).submit(tenant,actor,payload(),{} as RedeliveryExpected)).rejects.toThrow();expect(d.send).not.toHaveBeenCalled();
 });
});
