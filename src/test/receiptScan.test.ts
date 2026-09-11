import { describe, expect, it } from 'vitest';
import {
  areReceiptCornersStable,
  confirmReceiptScanQuality,
  detectReceiptCrop,
  detectReceiptCorners,
  detectReceiptDocument,
  evaluateReceiptQuality,
  isReceiptScanAcceptable,
  normalizeReceiptCrop,
  nextReceiptCornerHistory,
  projectReceiptPoint,
} from '@/lib/driver/receiptScan';
import { BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS } from '@/lib/driver/receiptQualityPolicy';

function checkerboard(width:number,height:number) {
  const pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y+=1)for(let x=0;x<width;x+=1){
    const offset=(y*width+x)*4;
    const value=(Math.floor(x/4)+Math.floor(y/4))%2?50:230;
    pixels[offset]=value;pixels[offset+1]=value;pixels[offset+2]=value;pixels[offset+3]=255;
  }
  return pixels;
}

describe('receipt document scan policy',()=>{
  it('clamps manual edges and preserves a usable crop area',()=>{
    expect(normalizeReceiptCrop({left:-1,top:0.9,right:2,bottom:0.1}))
      .toEqual({left:0,top:0.8,right:1,bottom:0.9500000000000001});
  });

  it('detects strong paper edges in each outer region',()=>{
    const width=120,height=160,pixels=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y+=1)for(let x=0;x<width;x+=1){
      const inside=x>=12&&x<108&&y>=16&&y<144;
      const value=inside?235:25,offset=(y*width+x)*4;
      pixels[offset]=value;pixels[offset+1]=value;pixels[offset+2]=value;pixels[offset+3]=255;
    }
    const crop=detectReceiptCrop(pixels,width,height);
    expect(crop.left).toBeCloseTo(0.1,1);
    expect(crop.right).toBeCloseTo(0.9,1);
    expect(crop.top).toBeCloseTo(0.1,1);
    expect(crop.bottom).toBeCloseTo(0.9,1);
    const corners=detectReceiptCorners(pixels,width,height);
    expect(corners.topLeft.x).toBeLessThan(corners.topRight.x);
    expect(corners.topLeft.y).toBeLessThan(corners.bottomLeft.y);
    const detection=detectReceiptDocument(pixels,width,height);
    expect(detection.present).toBe(true);
    expect(detection.confidence).toBeGreaterThanOrEqual(.55);
    expect(detection.corners).not.toBeNull();
    expect(detection.metrics.edgeContrast).toBeGreaterThanOrEqual(18);
  });

  it('does not treat a uniform frame or its fallback polygon as paper',()=>{
    const width=120,height=160,pixels=new Uint8ClampedArray(width*height*4);
    for(let offset=0;offset<pixels.length;offset+=4){pixels[offset]=120;pixels[offset+1]=120;pixels[offset+2]=120;pixels[offset+3]=255;}
    const fallback=detectReceiptCorners(pixels,width,height),detection=detectReceiptDocument(pixels,width,height);
    expect(fallback).toBeDefined();
    expect(detection.present).toBe(false);
    expect(detection.corners).toBeNull();
    expect(detection.metrics.edgeContrast).toBe(0);
    expect(nextReceiptCornerHistory([fallback,fallback,fallback],detection)).toEqual([]);
  });

  it('requires four consecutive stable polygons before automatic capture',()=>{
    const base={topLeft:{x:.1,y:.1},topRight:{x:.9,y:.1},bottomRight:{x:.9,y:.9},bottomLeft:{x:.1,y:.9}};
    expect(areReceiptCornersStable([base,base,base])).toBe(false);
    expect(areReceiptCornersStable([base,base,base,base])).toBe(true);
    expect(areReceiptCornersStable([base,base,base,{...base,topLeft:{x:.2,y:.1}}])).toBe(false);
  });

  it('uses a projective transform that maps the complete output to the four paper corners',()=>{
    const corners={topLeft:{x:.1,y:.12},topRight:{x:.82,y:.04},bottomRight:{x:.94,y:.92},bottomLeft:{x:.03,y:.78}};
    const expected=[{u:0,v:0,x:99.9,y:95.88},{u:1,v:0,x:819.18,y:31.96},
      {u:1,v:1,x:939.06,y:735.08},{u:0,v:1,x:29.97,y:623.22}];
    for(const point of expected){const projected=projectReceiptPoint(corners,1000,800,point.u,point.v);
      expect(projected.x).toBeCloseTo(point.x,6);expect(projected.y).toBeCloseTo(point.y,6);}
    const center=projectReceiptPoint(corners,1000,800,.5,.5);
    expect(center.x).toBeGreaterThan(400);
    expect(center.x).toBeLessThan(500);
    expect(center.y).toBeGreaterThan(300);
  });

  it('always rejects a scan whose paper is visibly cut by the photo boundary',()=>{
    const corners={topLeft:{x:0,y:.1},topRight:{x:.9,y:.1},bottomRight:{x:.9,y:.9},bottomLeft:{x:0,y:.9}};
    const quality=evaluateReceiptQuality(checkerboard(1000,1000),2000,2000,1000,1000,{corners});
    expect(quality.accepted).toBe(false);
    expect(quality.rejectionReasons).toContain('O papel foi cortado pela borda da foto. Afaste o celular e fotografe novamente.');
  });

  it('accepts a sufficiently large, illuminated and sharp scan',()=>{
    const quality=evaluateReceiptQuality(checkerboard(1000,1000),2000,2000,1000,1000);
    expect(quality.accepted).toBe(true);
    expect(quality.warnings).toEqual([]);
  });

  it('applies the effective client thresholds instead of hardcoded limits',()=>{
    const pixels=checkerboard(1000,1000);
    const baseline=evaluateReceiptQuality(pixels,2000,2000,1000,1000);
    const client=evaluateReceiptQuality(pixels,2000,2000,1000,1000,{thresholds:{
      ...BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS,min_source_pixels:5_000_000,
    }});
    expect(baseline.accepted).toBe(true);
    expect(client.accepted).toBe(false);
    expect(client.rejectionReasons).toContain('A câmera precisa gerar pelo menos 5 MP.');
  });

  it('rejects low-resolution blank captures with actionable reasons',()=>{
    const pixels=new Uint8ClampedArray(100*100*4).fill(250);
    const quality=evaluateReceiptQuality(pixels,100,100,100,100);
    expect(quality.accepted).toBe(false);
    expect(quality.warnings).toEqual(expect.arrayContaining([
      'A câmera precisa gerar pelo menos 2 MP.',
      'A área recortada ficou pequena demais.',
      'O texto tem pouco contraste com o papel.',
      'A imagem parece desfocada. Firme o celular e tente novamente.',
    ]));
  });

  it('blocks an intermediate scan until the driver explicitly confirms legibility',()=>{
    const pixels=checkerboard(1000,1000);
    for(let index=0;index<pixels.length*.12;index+=4){pixels[index]=255;pixels[index+1]=255;pixels[index+2]=255;}
    const quality=evaluateReceiptQuality(pixels,2000,2000,1000,1000);
    expect(quality.accepted).toBe(true);
    expect(quality.requiresConfirmation).toBe(true);
    const scan={original:new File(['a'],'a.jpg',{type:'image/jpeg'}),processed:new File(['b'],'b.jpg',{type:'image/jpeg'}),
      capturedAt:new Date().toISOString(),scanMode:'document_scan' as const,crop:{left:.1,top:.1,right:.9,bottom:.9},quality};
    expect(isReceiptScanAcceptable(scan)).toBe(false);
    expect(isReceiptScanAcceptable(confirmReceiptScanQuality(scan))).toBe(true);
  });
});
