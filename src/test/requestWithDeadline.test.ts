import {afterEach,expect,it,vi} from 'vitest';
import {requestWithDeadline} from '@/lib/requestWithDeadline';
afterEach(()=>vi.useRealTimers());
it('releases a stalled send and aborts its transport without claiming a server result',async()=>{
 vi.useFakeTimers();let signal:AbortSignal|undefined;
 const pending=requestWithDeadline(value=>{signal=value;return new Promise(()=>{});},20000);
 const result=expect(pending).rejects.toThrow('sem confirmação');
 await vi.advanceTimersByTimeAsync(20000);await result;expect(signal?.aborted).toBe(true);
});
it('returns a confirmed result immediately and clears the deadline',async()=>{
 vi.useFakeTimers();await expect(requestWithDeadline(async()=>({confirmed:true}),20000)).resolves.toEqual({confirmed:true});
 expect(vi.getTimerCount()).toBe(0);
});
