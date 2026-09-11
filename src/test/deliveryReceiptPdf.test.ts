import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DELIVERY_RECEIPT_PDF_MAX_BYTES,
  DELIVERY_RECEIPT_PDF_MIN_DPI,
  deliveryReceiptFileName,
  deliveryReceiptPdfMetrics,
  downloadDeliveryReceiptPdf,
  queueAndSendDeliveryReceiptEmail,
  type DeliveryReceiptRow,
} from '@/lib/deliveryReceipts/deliveryReceiptOperations';
import {defaultDeliveryReceiptCoverConfig} from '@/lib/deliveryReceipts/deliveryReceiptSupplier';

const mocks=vi.hoisted(()=>({rpc:vi.fn(),download:vi.fn(),invoke:vi.fn(),upload:vi.fn(),remove:vi.fn(),addImage:vi.fn(),
  pdfOutput:vi.fn(),click:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
  rpc:mocks.rpc,storage:{from:()=>({download:mocks.download})},functions:{invoke:mocks.invoke},
}}));
vi.mock('@/lib/secureUpload',()=>({uploadSecureFile:mocks.upload,removeSecureFiles:mocks.remove}));
vi.mock('jspdf',()=>({default:class FakePdf{
  internal={pageSize:{getWidth:()=>210,getHeight:()=>297}};
  addImage=mocks.addImage;
  output(){return mocks.pdfOutput();}
}}));

const tenant='20000000-0000-4000-8000-000000000001';
const actor='10000000-0000-4000-8000-000000000001';
const receipt='30000000-0000-4000-8000-000000000001';
const updated='2026-09-10T14:00:00.000Z';
const row:DeliveryReceiptRow={
  id:receipt,delivery_event_id:'40000000-0000-4000-8000-000000000001',trip_id:'50000000-0000-4000-8000-000000000001',
  stop_id:'60000000-0000-4000-8000-000000000001',delivered_at:'2026-09-10T12:00:00.000Z',captured_at:null,
  digital_status:'validated',physical_status:'received',email_status:'not_sent',scan_mode:'document_scan',has_original:true,
  has_processed:true,has_pdf:false,receiver_name:'Recebedor',driver:{id:'70000000-0000-4000-8000-000000000001',name:'Motorista'},
  vehicle:{id:'80000000-0000-4000-8000-000000000001',plate:'ABC1D23'},client:null,load_ids:[],destination:'Cliente',documents:[{
    id:'90000000-0000-4000-8000-000000000001',kind:'nfse',number:'NFS-9',series:null,access_key:null,issue_date:null,
    issuer_name:'Fornecedor QA',issuer_tax_id:null,recipient_name:null,supplier_id:null,operational_reference:null,
  }],updated_at:updated,
};

beforeEach(()=>{
  vi.clearAllMocks();
  localStorage.clear();
  mocks.download.mockResolvedValue({data:new Blob(['%PDF-1.4 EXISTING'],{type:'application/pdf'}),error:null});
  mocks.upload.mockResolvedValue(`${tenant}/delivery-pdfs/${receipt}/generated.pdf`);
  mocks.remove.mockResolvedValue(undefined);
  mocks.pdfOutput.mockReset().mockReturnValue(new Blob(['%PDF-1.4 QA'],{type:'application/pdf'}));
  vi.stubGlobal('URL',{createObjectURL:vi.fn(()=> 'blob:pdf'),revokeObjectURL:vi.fn()});
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(mocks.click);
});

function stubScanImage(width:number,height:number){
  class FakeImage{naturalWidth=width;naturalHeight=height;onload:()=>void=()=>undefined;onerror:()=>void=()=>undefined;
    set src(_value:string){queueMicrotask(()=>this.onload());}}
  vi.stubGlobal('Image',FakeImage);
}

function stubCanvasEncoder(){
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn()} as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/jpeg;base64,Y29tcHJlc3NlZA==');
}

function response(name:string,args:Record<string,string>,source:'pdf'|'processed_image'='pdf'){
  if(name==='prepare_delivery_receipt_pdf_v1')return Promise.resolve({data:{version:1,tenant_id:tenant,actor_id:actor,
    request_id:args._request_id,receipt_id:receipt,bucket:'receipts',source_kind:source,
    path:source==='pdf'?`${tenant}/delivery-pdfs/${receipt}/existing.pdf`:`${tenant}/deliveries/scan.jpg`,
    file_name:args._file_name,receipt_updated_at:updated},error:null});
  if(name==='attach_delivery_receipt_pdf_v1')return Promise.resolve({data:{version:1,receipt_id:receipt,path:args._path,
    updated_at:'2026-09-10T14:01:00.000Z',confirmed:true},error:null});
  if(name==='complete_delivery_receipt_pdf_download_v1')return Promise.resolve({data:{version:1,request_id:args._request_id,
    receipt_id:receipt,status:'completed',completed_at:'2026-09-10T14:02:00.000Z',confirmed:true},error:null});
  throw new Error(`RPC inesperado: ${name}`);
}

describe('delivery receipt PDF export',()=>{
  it('names the individual PDF with supplier, delivery date, load and delivery identifiers',()=>{
    expect(deliveryReceiptFileName({...row,load_ids:['90000000-0000-4000-8000-000000000009']}))
      .toBe('CANHOTO_Fornecedor-QA_2026-09-10_CARGA-90000000_ENTREGA-40000000.pdf');
  });

  it('calculates effective resolution from the physical area occupied on A4',()=>{
    const metrics=deliveryReceiptPdfMetrics(1600,2200);
    expect(metrics.orientation).toBe('portrait');
    expect(metrics.widthMm).toBeCloseTo(202,3);
    expect(metrics.effectiveDpi).toBeGreaterThanOrEqual(DELIVERY_RECEIPT_PDF_MIN_DPI);
    expect(deliveryReceiptPdfMetrics(1000,1400).effectiveDpi).toBeLessThan(DELIVERY_RECEIPT_PDF_MIN_DPI);
  });

  it('downloads an existing private PDF and completes its audit receipt',async()=>{
    mocks.rpc.mockImplementation((name:string,args:Record<string,string>)=>response(name,args));
    await downloadDeliveryReceiptPdf(tenant,actor,row);
    expect(mocks.download).toHaveBeenCalledWith(`${tenant}/delivery-pdfs/${receipt}/existing.pdf`);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('complete_delivery_receipt_pdf_download_v1',expect.objectContaining({_tenant_id:tenant,_receipt_id:receipt}));
    expect(mocks.click).toHaveBeenCalledTimes(1);
  });

  it('generates, preserves and attaches an individual PDF when only the processed scan exists',async()=>{
    mocks.download.mockResolvedValue({data:new Blob(['scan'],{type:'image/jpeg'}),error:null});
    stubScanImage(1600,2200);
    mocks.rpc.mockImplementation((name:string,args:Record<string,string>)=>response(name,args,'processed_image'));
    await downloadDeliveryReceiptPdf(tenant,actor,{...row,has_pdf:false});
    expect(mocks.addImage).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({tenantId:tenant,bucket:'receipts',
      folder:`delivery-pdfs/${receipt}`,kind:'proof',file:expect.objectContaining({type:'application/pdf'})}));
    expect(mocks.rpc).toHaveBeenCalledWith('attach_delivery_receipt_pdf_v1',expect.objectContaining({_receipt_id:receipt,
      _path:`${tenant}/delivery-pdfs/${receipt}/generated.pdf`,_expected_updated_at:updated}));
    expect(mocks.click).toHaveBeenCalledTimes(1);
  });

  it('rejects a scan that cannot occupy A4 at 200 DPI and asks for recapture',async()=>{
    mocks.download.mockResolvedValue({data:new Blob(['scan'],{type:'image/jpeg'}),error:null});
    stubScanImage(1000,1400);
    mocks.rpc.mockImplementation((name:string,args:Record<string,string>)=>response(name,args,'processed_image'));
    await expect(downloadDeliveryReceiptPdf(tenant,actor,{...row,has_pdf:false}))
      .rejects.toThrow(/200 DPI.*Recapture o canhoto/i);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.click).not.toHaveBeenCalled();
  });

  it('compresses an oversized PDF while retaining at least 200 DPI',async()=>{
    mocks.download.mockResolvedValue({data:new Blob(['scan'],{type:'image/png'}),error:null});
    stubScanImage(3000,4200);stubCanvasEncoder();
    mocks.pdfOutput.mockReset()
      .mockReturnValueOnce(new Blob([new Uint8Array(DELIVERY_RECEIPT_PDF_MAX_BYTES+1)],{type:'application/pdf'}))
      .mockReturnValue(new Blob(['%PDF-1.4 COMPRESSED'],{type:'application/pdf'}));
    mocks.rpc.mockImplementation((name:string,args:Record<string,string>)=>response(name,args,'processed_image'));
    await downloadDeliveryReceiptPdf(tenant,actor,{...row,has_pdf:false});
    expect(mocks.addImage).toHaveBeenCalledTimes(2);
    expect(mocks.addImage.mock.calls[1][1]).toBe('JPEG');
    const uploaded=mocks.upload.mock.calls[0][0].file as File;
    expect(uploaded.size).toBeLessThanOrEqual(DELIVERY_RECEIPT_PDF_MAX_BYTES);
  });

  it('fails instead of crossing 200 DPI when no compressed PDF fits in 5 MiB',async()=>{
    mocks.download.mockResolvedValue({data:new Blob(['scan'],{type:'image/jpeg'}),error:null});
    stubScanImage(3000,4200);stubCanvasEncoder();
    mocks.pdfOutput.mockReset().mockReturnValue(new Blob([new Uint8Array(DELIVERY_RECEIPT_PDF_MAX_BYTES+1)],{type:'application/pdf'}));
    mocks.rpc.mockImplementation((name:string,args:Record<string,string>)=>response(name,args,'processed_image'));
    await expect(downloadDeliveryReceiptPdf(tenant,actor,{...row,has_pdf:false}))
      .rejects.toThrow(/5 MB.*200 DPI.*Recapture o canhoto/i);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.click).not.toHaveBeenCalled();
  });

  it('queues a supplier batch and invokes the authenticated sender with the same idempotency key',async()=>{
    mocks.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
      if(name!=='queue_delivery_receipt_email_v2')throw new Error(`RPC inesperado: ${name}`);
      return Promise.resolve({data:{version:1,batch_id:args._request_id,status:'queued',receipt_count:1,confirmed:true},error:null});
    });
    mocks.invoke.mockImplementation((_name:string,{body}:{body:{batch_id:string}})=>Promise.resolve({data:{batch_id:body.batch_id,
      status:'sent',provider_message_id:'email-provider-1',replayed:false},error:null}));
    const sent=await queueAndSendDeliveryReceiptEmail(tenant,actor,{supplierKey:'tax:00123456000100',supplier:'Fornecedor QA',receiptIds:[receipt],
      recipients:['fiscal@fornecedor.test'],subject:'Comprovante de entrega',body:'Segue o comprovante solicitado.',cover:defaultDeliveryReceiptCoverConfig});
    const queued=mocks.rpc.mock.calls[0][1];
    expect(mocks.invoke).toHaveBeenCalledWith('send-delivery-receipts',{body:{tenant_id:tenant,batch_id:queued._request_id}});
    expect(sent).toMatchObject({status:'sent',provider_message_id:'email-provider-1'});
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem(localStorage.key(0)!)).toBe('[]');
  });

  it('reuses the durable batch id when a manual retry follows an unconfirmed invocation',async()=>{
    mocks.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
      if(name!=='queue_delivery_receipt_email_v2')throw new Error(`RPC inesperado: ${name}`);
      return Promise.resolve({data:{version:1,batch_id:args._request_id,status:'queued',receipt_count:1,confirmed:true},error:null});
    });
    mocks.invoke.mockResolvedValueOnce({data:null,error:new Error('rede indisponível')}).mockImplementationOnce(
      (_name:string,{body}:{body:{batch_id:string}})=>Promise.resolve({data:{batch_id:body.batch_id,status:'sent',
        provider_message_id:'email-provider-2',replayed:true},error:null}),
    );
    const draft={supplierKey:'tax:00123456000100',supplier:'Fornecedor QA',receiptIds:[receipt],recipients:['fiscal@fornecedor.test'],
      subject:'Comprovante de entrega',body:'Segue o comprovante solicitado.',cover:defaultDeliveryReceiptCoverConfig};
    await expect(queueAndSendDeliveryReceiptEmail(tenant,actor,draft)).rejects.toThrow('rede indisponível');
    await queueAndSendDeliveryReceiptEmail(tenant,actor,draft);
    expect(mocks.rpc.mock.calls[0][1]._request_id).toBe(mocks.rpc.mock.calls[1][1]._request_id);
    expect(mocks.invoke.mock.calls[0][1].body.batch_id).toBe(mocks.invoke.mock.calls[1][1].body.batch_id);
  });

  it('rejects more than five PDFs before creating a provider batch',async()=>{
    const receipts=Array.from({length:6},(_,index)=>`30000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`);
    await expect(queueAndSendDeliveryReceiptEmail(tenant,actor,{supplierKey:'tax:00123456000100',supplier:'Fornecedor QA',receiptIds:receipts,
      recipients:['fiscal@fornecedor.test'],subject:'Comprovante de entrega',body:'Segue o comprovante solicitado.',cover:defaultDeliveryReceiptCoverConfig}))
      .rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
