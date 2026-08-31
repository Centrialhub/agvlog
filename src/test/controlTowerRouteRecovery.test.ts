import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {calculateTripRoute} from '@/lib/controlTower/routeCalculation';
const mock=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mock.invoke}}}));
const tenant='20000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000001',trip='80000000-0000-4000-8000-000000000001';
const key=`agvlog:route:v1:${tenant}:${actor}:${trip}`;
const receipt=(request:string)=>({data:{ok:true,request_id:request,trip_id:trip,route_id:trip,calculated_at:'2026-08-31T12:00:00Z',distance_meters:100,duration_seconds:50,waypoint_count:2},error:null});
beforeEach(()=>{localStorage.clear();mock.invoke.mockReset();vi.useFakeTimers();});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();localStorage.clear();});
describe('route client deadline and durable recovery',()=>{
 it('deduplicates simultaneous requests in the same account/tenant/trip',async()=>{
  mock.invoke.mockImplementation(async(_name:string,args:{body:{request_id:string}})=>receipt(args.body.request_id));
  const first=calculateTripRoute(tenant,actor,trip),second=calculateTripRoute(tenant,actor,trip);expect(second).toBe(first);
  await expect(first).resolves.toMatchObject({ok:true});expect(mock.invoke).toHaveBeenCalledOnce();expect(localStorage.getItem(key)).toBeNull();
 });
 it('times out a hung request, ignores a late reply and recovers the same identity',async()=>{
  let settle!:(value:unknown)=>void;mock.invoke.mockImplementationOnce(()=>new Promise(resolve=>{settle=resolve;}));
  const task=calculateTripRoute(tenant,actor,trip),failed=expect(task).rejects.toThrow(/Tempo esgotado/);await vi.advanceTimersByTimeAsync(30001);await failed;
  const request=localStorage.getItem(key)!;expect(request).toBeTruthy();expect(mock.invoke.mock.calls[0][1].signal.aborted).toBe(true);
  settle(receipt(request));await Promise.resolve();await Promise.resolve();expect(localStorage.getItem(key)).toBe(request);
  mock.invoke.mockResolvedValueOnce(receipt(request));await expect(calculateTripRoute(tenant,actor,trip)).resolves.toMatchObject({request_id:request});
  expect(mock.invoke.mock.calls[1][1].body.request_id).toBe(request);expect(localStorage.getItem(key)).toBeNull();
 });
 it('also bounds reading an error response body and keeps the request recoverable',async()=>{
  const context=new Response('{}',{status:500});vi.spyOn(context,'clone').mockReturnValue(context);vi.spyOn(context,'json').mockImplementation(()=>new Promise(()=>{}));
  mock.invoke.mockResolvedValueOnce({data:null,error:{context}});
  const failed=expect(calculateTripRoute(tenant,actor,trip)).rejects.toThrow(/Tempo esgotado/);await vi.advanceTimersByTimeAsync(30001);await failed;
  expect(localStorage.getItem(key)).toBeTruthy();expect(mock.invoke.mock.calls[0][1].signal.aborted).toBe(true);
 });
});
