// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
let calculate:(coordinates:{lat:number;lng:number}[],options?:{timeoutMs?:number})=>Promise<unknown>;
const coords=[{lat:-23.1,lng:-46.1},{lat:-23,lng:-46}];
const good={code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[-46.1,-23.1],[-46,-23]]},distance:15000,duration:900}],waypoints:[{location:[-46.1,-23.1]},{location:[-46,-23]}]};
beforeAll(async()=>{vi.stubGlobal('Deno',{env:{get:()=> 'https://router.example.test'}});const path='../../supabase/functions/_shared/osrm.ts';calculate=(await import(path)).calculateOsrmRoute;});
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(good)))));
afterEach(()=>{vi.useRealTimers();});afterAll(()=>vi.unstubAllGlobals());
describe('approved OSRM transport with zero real provider calls',()=>{
 it('uses longitude/latitude order and strips unnecessary provider data',async()=>{
  expect(await calculate(coords)).toEqual({provider:'osrm',geometryGeoJson:good.routes[0].geometry,distanceMeters:15000,durationSeconds:900,waypoints:good.waypoints});
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/driving/-46.1,-23.1;-46,-23?'),expect.objectContaining({signal:expect.any(AbortSignal)}));
 });
 it.each([{lat:Infinity,lng:0},{lat:91,lng:0},{lat:0,lng:181},{lat:NaN,lng:0}])('rejects invalid input %# before sending coordinates',async point=>{
  await expect(calculate([point,coords[1]])).rejects.toThrow(/Invalid OSRM coordinate/);expect(fetch).not.toHaveBeenCalled();
 });
 it.each([{...good,waypoints:[]},{...good,routes:[{...good.routes[0],distance:-1}]},{...good,routes:[{...good.routes[0],geometry:{type:'LineString',coordinates:[[200,0],[0,0]]}}]},
  {...good,waypoints:[null,null]},{code:'NoRoute',routes:[]}])('rejects malformed provider response %#',async payload=>{
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(payload)));await expect(calculate(coords)).rejects.toThrow();
 });
 it('keeps the timeout active while reading the response body',async()=>{
  vi.useFakeTimers();vi.mocked(fetch).mockImplementation(async(_url,options)=>({ok:true,json:()=>new Promise((_resolve,reject)=>options?.signal?.addEventListener('abort',()=>reject(new Error('QA body timeout'))))}) as Response);
  const promise=expect(calculate(coords,{timeoutMs:20})).rejects.toThrow(/QA body timeout/);await vi.advanceTimersByTimeAsync(21);await promise;
 });
});
