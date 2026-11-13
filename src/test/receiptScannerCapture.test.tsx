import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DeliveryReceiptScanner from '@/components/driver/DeliveryReceiptScanner';
import { BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS } from '@/lib/driver/receiptQualityPolicy';

const mocks=vi.hoisted(()=>({scan:vi.fn(),stop:vi.fn()}));
vi.mock('@/lib/driver/receiptScan',async original=>({...await original<typeof import('@/lib/driver/receiptScan')>(),processReceiptScan:mocks.scan}));
const policy={source:'baseline' as const,policy_id:null,version:1,tenant_id:'10000000-0000-4000-8000-000000000001',client_id:null,
  thresholds:BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS,resolved_at:'2026-11-13T00:00:00Z'};

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('captures the complete sensor image and redetects its edges instead of cropping by the reduced preview',async()=>{
  vi.stubGlobal('URL',{createObjectURL:vi.fn(()=> 'blob:test'),revokeObjectURL:vi.fn()});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn(async()=>({getTracks:()=>[{stop:mocks.stop}]}))}});
  vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue(undefined);
  const draw=vi.fn();vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>({drawImage:draw}) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>callback(new Blob(['full-sensor-photo'],{type:'image/jpeg'})));
  const photo=new File(['scan'],'scan.jpg',{type:'image/jpeg'});
  const result={original:photo,processed:photo,corners:{topLeft:{x:.1,y:.1},topRight:{x:.9,y:.1},bottomRight:{x:.9,y:.9},bottomLeft:{x:.1,y:.9}},
    quality:{accepted:false,warnings:['Ajuste as bordas'],requiresConfirmation:false,processedWidth:2000,processedHeight:1500},rotation:0};
  mocks.scan.mockResolvedValue(result);
  function Story(){return <DeliveryReceiptScanner value={null} qualityPolicy={policy} onChange={changed} onError={vi.fn()}/>;}
  const changed=vi.fn();render(<Story/>);
  fireEvent.click(screen.getByRole('button',{name:'Abrir scanner'}));
  const video=await screen.findByLabelText('Prévia da câmera');
  Object.defineProperties(video,{videoWidth:{value:4032,configurable:true},videoHeight:{value:3024,configurable:true}});
  fireEvent.loadedMetadata(video);
  expect(video.parentElement?.style.aspectRatio).toBe(String(4/3));
  expect(video.className).toContain('absolute inset-0 h-full w-full');
  fireEvent.click(screen.getByRole('button',{name:'Capturar agora'}));
  await waitFor(()=>expect(changed).toHaveBeenCalledWith(result));
  expect(draw).toHaveBeenCalledWith(video,0,0,4032,3024);
  expect(mocks.scan.mock.calls[0][1]).toEqual({rotation:0,qualityPolicy:policy});
  expect(mocks.stop).toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Fotografar com a câmera do celular'})).toBeVisible();
});
