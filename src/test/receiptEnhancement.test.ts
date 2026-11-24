import { expect, it } from 'vitest';
import { enhanceReceiptPixels } from '@/lib/driver/receiptEnhancement';

it('lifts uneven paper illumination while retaining black writing and coloured signature pixels', () => {
  const width=128,height=64,pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const offset=(y*width+x)*4;pixels.set([x<64?155:230,x<64?155:230,x<64?155:230,255],offset);
  }
  const black=(30*width+20)*4,blue=(31*width+20)*4;
  pixels.set([0,0,0,255],black);pixels.set([20,40,120,255],blue);
  const before=new Uint8ClampedArray(pixels),result=enhanceReceiptPixels(pixels,width,height);
  expect(pixels).toEqual(before);expect(result[0]).toBeGreaterThan(pixels[0]);
  expect(result.slice(black,black+4)).toEqual(new Uint8ClampedArray([0,0,0,255]));
  expect(result[blue+2]).toBeGreaterThan(result[blue+1]);expect(result[blue+1]).toBeGreaterThan(result[blue]);
  expect(result[blue+3]).toBe(255);
});

it('rejects invalid image dimensions and never changes image size',()=>{
  expect(()=>enhanceReceiptPixels(new Uint8ClampedArray(4),0,1)).toThrow();
  expect(enhanceReceiptPixels(new Uint8ClampedArray([120,120,120,255]),1,1)).toHaveLength(4);
});
