import {beforeEach,describe,it,expect,vi} from 'vitest';
import {uploadSecureFile} from '@/lib/secureUpload';
import {deliveryFailure,newDeliveryRetry} from '@/lib/driver/driverDeliveryRetryPolicy';
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
vi.mock('@/lib/uploadPolicy',()=>({validateUploadContent:vi.fn().mockResolvedValue(undefined)}));
beforeEach(()=>{vi.restoreAllMocks();mocks.invoke.mockReset();});
const request=()=>({tenantId:'synthetic',bucket:'receipts' as const,folder:'deliveries/trip/stop',kind:'image' as const,file:new File(['synthetic'],'proof.png',{type:'image/png'})});
describe('secure upload safe retry error metadata',()=>{
  it('preserves the real numeric 400 and gateway code without copying response headers',async()=>{
    mocks.invoke.mockResolvedValue({data:null,error:{context:new Response(JSON.stringify({error:'invalid_upload',private:'never forward'}),{status:400,headers:{'x-private':'never forward'}})}});
    const error=await uploadSecureFile(request()).catch(value=>value);
    expect(error).toMatchObject({status:400,code:'invalid_upload'});expect(Object.keys(error).sort()).toEqual(['code','retryAfterMs','status']);
    expect(deliveryFailure(newDeliveryRetry(),error).terminal).toBe(true);expect(error.message).not.toContain('never forward');
  });
  it.each(['90','1.5'])('extracts only Retry-After seconds %s',header=>{
    mocks.invoke.mockResolvedValue({data:null,error:{context:new Response('{"error":"upload_rate_limited"}',{status:429,headers:{'retry-after':header}})}});
    return expect(uploadSecureFile(request())).rejects.toMatchObject({status:429,code:'upload_rate_limited',retryAfterMs:Number(header)*1000});
  });
  it('supports HTTP date Retry-After',async()=>{
    const now=Date.parse('2026-10-14T10:00:00Z');vi.spyOn(Date,'now').mockReturnValue(now);
    mocks.invoke.mockResolvedValue({data:null,error:{context:new Response('not JSON',{status:429,headers:{'retry-after':'Wed, 14 Oct 2026 10:02:00 GMT'}})}});
    await expect(uploadSecureFile(request())).rejects.toMatchObject({status:429,retryAfterMs:120_000});
  });
  it.each(['garbage','Infinity','-5'])('does not invent a wait from malformed header %s',header=>{
    mocks.invoke.mockResolvedValue({data:null,error:{context:new Response('not JSON',{status:503,headers:{'retry-after':header}})}});
    return expect(uploadSecureFile(request())).rejects.toMatchObject({status:503,retryAfterMs:undefined});
  });
});
