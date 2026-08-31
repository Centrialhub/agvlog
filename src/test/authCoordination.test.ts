import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {authSessionLock} from '@/lib/auth/authSessionCoordination';
import {boundedAuthFetch} from '@/lib/auth/boundedAuthFetch';
import {installTestWebLocks} from './helpers/testWebLocks';
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
let locks:ReturnType<typeof installTestWebLocks>;
beforeEach(()=>{locks=installTestWebLocks();});afterEach(()=>{locks.restore();vi.useRealTimers();vi.restoreAllMocks();});
describe('Auth coordination primitives',()=>{
 it.each([true,false])('never releases a held lock or executes an expired waiter (Web Locks=%s)',async shared=>{
  if(!shared)locks.restore();vi.useFakeTimers();const hold=deferred<void>();const order:string[]=[];
  const first=authSessionLock('held-'+shared,10,async()=>{order.push('first');await hold.promise;});await vi.advanceTimersByTimeAsync(1);
  const expired=authSessionLock('held-'+shared,10,async()=>{order.push('must-not-run');}).catch(error=>error);
  await vi.advanceTimersByTimeAsync(25);expect(await expired).toHaveProperty('isAcquireTimeout',true);expect(order).toEqual(['first']);
  const third=authSessionLock('held-'+shared,100,async()=>{order.push('third');});hold.resolve();await Promise.all([first,third]);
  expect(order).toEqual(['first','third']);expect(locks.calls.every(call=>!call.options.steal)).toBe(true);
 });
 it('releases a lock after failure and permits independent session slots',async()=>{
  await expect(authSessionLock('failure',100,async()=>{throw new Error('QA failure');})).rejects.toThrow('QA failure');
  expect(await authSessionLock('failure',100,async()=>42)).toBe(42);
  const hold=deferred<void>();const first=authSessionLock('one',100,()=>hold.promise);expect(await authSessionLock('two',100,async()=>2)).toBe(2);hold.resolve();await first;
 });
 it('rejects an unavailable immediate lock instead of running without exclusion',async()=>{
  const hold=deferred<void>(),entered=deferred<void>();const first=authSessionLock('immediate',100,async()=>{entered.resolve();await hold.promise;});await entered.promise;
  const work=vi.fn(async()=>undefined);await expect(authSessionLock('immediate',0,work)).rejects.toHaveProperty('isAcquireTimeout',true);
  expect(work).not.toHaveBeenCalled();hold.resolve();await first;
 });
 it('does not alter RPCs, fiscal requests or uploads outside Auth',async()=>{
  const response=Response.json({ok:true}),fetcher=vi.fn(async()=>response),request={method:'POST',body:'operational'};
  const fetch=boundedAuthFetch('https://qa.invalid',fetcher);
  expect(await fetch('https://qa.invalid/rest/v1/rpc/test',request)).toBe(response);expect(fetcher).toHaveBeenCalledWith('https://qa.invalid/rest/v1/rpc/test',request);
  expect(await fetch('https://other.invalid/auth/v1/user')).toBe(response);
 });
 it('preserves Auth status, headers and JSON error codes',async()=>{
  const fetch=boundedAuthFetch('https://qa.invalid',async()=>new Response('{"code":"mfa_verification_failed"}',{status:422,headers:{'x-supabase-api-version':'2024-01-01'}}));
  const response=await fetch('https://qa.invalid/auth/v1/factors/a/verify');expect(response.status).toBe(422);expect(response.headers.get('x-supabase-api-version')).toBe('2024-01-01');expect(await response.json()).toEqual({code:'mfa_verification_failed'});
 });
 it('bounds headers that never arrive even when the transport ignores abort',async()=>{
  vi.useFakeTimers();const pending=deferred<Response>();let signal:AbortSignal|undefined;
  const fetch=boundedAuthFetch('https://qa.invalid',async(_url,init)=>{signal=init?.signal??undefined;return pending.promise;});
  const result=fetch('https://qa.invalid/auth/v1/user').catch(error=>error);await vi.advanceTimersByTimeAsync(5001);expect(await result).toBeInstanceOf(Error);expect(signal?.aborted).toBe(true);
  pending.resolve(Response.json({late:true}));await Promise.resolve();
 });
 it('bounds response-body consumption, not only receipt of headers',async()=>{
  vi.useFakeTimers();const body=deferred<string>();const response=Response.json({});vi.spyOn(response,'text').mockReturnValue(body.promise);
  const fetch=boundedAuthFetch('https://qa.invalid',async()=>response);const result=fetch('https://qa.invalid/auth/v1/user').catch(error=>error);
  await vi.advanceTimersByTimeAsync(5001);expect(await result).toBeInstanceOf(Error);body.resolve('{"late":true}');await Promise.resolve();
 });
 it('honors caller cancellation without sending an already cancelled Auth request',async()=>{
  const controller=new AbortController();controller.abort();const fetcher=vi.fn(async()=>Response.json({}));
  await expect(boundedAuthFetch('https://qa.invalid',fetcher)('https://qa.invalid/auth/v1/user',{signal:controller.signal})).rejects.toThrow(/interrompida/);expect(fetcher).not.toHaveBeenCalled();
 });
});
