// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {inspectQuarantineImage,sanitizeQuarantineImage} from '../../supabase/functions/secure-upload/quarantine-image';
function png(width=1,height=1){const bytes=new Uint8Array(45);bytes.set([137,80,78,71,13,10,26,10]);const v=new DataView(bytes.buffer);v.setUint32(8,13);bytes.set(new TextEncoder().encode('IHDR'),12);v.setUint32(16,width);v.setUint32(20,height);bytes[24]=8;bytes[25]=2;bytes.set(new TextEncoder().encode('IEND'),37);return bytes;}
it('rejects oversized pixels before invoking decoder',()=>{const encode=vi.fn();expect(()=>sanitizeQuarantineImage(png(2000,1200),{encode})).toThrow('pixel_limit');expect(encode).not.toHaveBeenCalled();});
it('rejects animation markers, trailing bytes and unknown formats',()=>{
 const image=png();const animation=new Uint8Array(image.length+12);animation.set(image.subarray(0,33));animation.set(new TextEncoder().encode('acTL'),37);animation.set(image.subarray(33),45);
 expect(()=>inspectQuarantineImage(animation)).toThrow('animation');expect(()=>inspectQuarantineImage(new Uint8Array([...image,0]))).toThrow('trailing');expect(()=>inspectQuarantineImage(new TextEncoder().encode('<svg/>'))).toThrow('format');
});
it('does not return usable result after processing budget or decoder failure',()=>{
 const clock=vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(1201);expect(()=>sanitizeQuarantineImage(png(),{encode:()=>png()},clock)).toThrow('budget');
 expect(()=>sanitizeQuarantineImage(png(),{encode:()=>{throw new Error('engine_failure');}})).toThrow('engine_failure');
});
it('checks resulting codec and pixel dimensions separately from source',()=>{
 expect(()=>sanitizeQuarantineImage(png(),{encode:()=>png(2,2)})).toThrow('mismatch');
 expect(sanitizeQuarantineImage(png(),{encode:()=>png()})).toMatchObject({state:'sanitized_derivative',method:'jpeg-png-reencode-v1',mime:'image/png'});
});
it('rejects truncated JPEG and non-eight-bit PNG headers',()=>{expect(()=>inspectQuarantineImage(new Uint8Array([255,216,255,192]))).toThrow('truncated');const image=png();image[24]=16;expect(()=>inspectQuarantineImage(image)).toThrow('header');});
