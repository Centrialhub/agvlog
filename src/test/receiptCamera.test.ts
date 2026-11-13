import { describe, expect, it } from 'vitest';
import { paddedReceiptCorners, receiptCameraLayout, RECEIPT_CAMERA_CONSTRAINTS } from '@/lib/driver/receiptCamera';

describe('receipt camera sensor coordinates',()=>{
  it.each([[1920,1080],[1080,1920],[4032,3024]])('keeps overlay and video at the same %sx%s aspect ratio',(width,height)=>{
    const layout=receiptCameraLayout(width,height);
    expect(Number(layout.aspectRatio)).toBeCloseTo(width/height);
    const maxWidthVh=Number(layout.width.match(/([\d.]+)vh/)?.[1]);
    expect(maxWidthVh/60).toBeCloseTo(width/height);
  });
  it('keeps an outside margin without moving corners beyond the photo or hiding a cut edge',()=>{
    const original={topLeft:{x:.1,y:.1},topRight:{x:.9,y:.1},bottomRight:{x:.9,y:.9},bottomLeft:{x:.1,y:.9}};
    const padded=paddedReceiptCorners(original);
    expect(padded.topLeft).toEqual({x:.08800000000000001,y:.08800000000000001});
    expect(padded.bottomRight.x).toBeGreaterThan(original.bottomRight.x);
    expect(original.topLeft.x).toBe(.1);
    expect(paddedReceiptCorners({...original,topLeft:{x:0,y:.02}}).topLeft).toEqual({x:0,y:.016});
  });
  it('requests a rear high-resolution sensor without excluding phones with lower supported resolutions',()=>{
    expect(RECEIPT_CAMERA_CONSTRAINTS).toEqual({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:3840},height:{ideal:2880}}});
  });
});
