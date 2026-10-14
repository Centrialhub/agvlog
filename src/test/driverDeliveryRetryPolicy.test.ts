import {describe,it,expect} from 'vitest';
import {deliveryFailure,deliveryRetryReady,errorStatus,isAuthorizationFailure,isDeliveryRetry,isRemoteConflict,newDeliveryRetry} from '@/lib/driver/driverDeliveryRetryPolicy';
describe('delivery retry policy',()=>{
  it.each([400,413,415,422])('classifies numeric %i even when a gateway code is textual',status=>{
    expect(deliveryFailure(newDeliveryRetry(),{status,code:'invalid_upload'},100)).toMatchObject({terminal:true,retry:{nextAttemptAt:null,lastStatus:status,lastCode:'invalid_upload'}});
  });
  it('uses the actual quota window when Retry-After is absent',()=>{
    const {retry}=deliveryFailure(newDeliveryRetry(),{context:{status:429},code:'upload_rate_limited'},100);
    expect(retry.nextAttemptAt).toBe(60_100);expect(deliveryRetryReady(retry,60_099)).toBe(false);expect(deliveryRetryReady(retry,60_100)).toBe(true);
  });
  it('backs off exponentially without resetting cumulative failures on success',()=>{
    let retry=newDeliveryRetry();const delays=[];
    for(let i=0;i<5;i++){const next=deliveryFailure({...retry,attempts:retry.attempts+1},{status:503},100);retry=next.retry;delays.push(retry.nextAttemptAt);expect(next.terminal).toBe(i===4);}
    expect(delays).toEqual([5_100,10_100,20_100,40_100,null]);
  });
  it.each([NaN,Infinity,-1,'12000'])('ignores invalid retry metadata %s',retryAfterMs=>{
    expect(deliveryFailure(newDeliveryRetry(),{status:429,retryAfterMs},100).retry.nextAttemptAt).toBe(60_100);
  });
  it('keeps status available for auth/conflict even if the code is textual',()=>{
    expect(errorStatus({code:'invalid_upload',context:{status:400}})).toBe(400);
    expect(isAuthorizationFailure({status:401,code:'invalid_jwt'})).toBe(true);
    expect(isRemoteConflict({status:409,code:'custom_conflict'})).toBe(true);
  });
  it('accepts valid durable metadata and rejects malformed counters/deadlines',()=>{
    expect(isDeliveryRetry(newDeliveryRetry())).toBe(true);
    for(const extra of [{attempts:-1},{failures:NaN},{nextAttemptAt:Infinity},{nextAttemptAt:-1},{version:2}])expect(isDeliveryRetry({...newDeliveryRetry(),...extra})).toBe(false);
    expect(deliveryRetryReady(undefined)).toBe(true);
  });
});
