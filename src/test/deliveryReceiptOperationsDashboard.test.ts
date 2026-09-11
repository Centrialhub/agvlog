import {beforeEach,describe,expect,it,vi} from 'vitest';
import {
  getDeliveryReceiptOperations,
  getDeliveryReceiptOcrHealth,
  listDeliveryReceiptEmailHistory,
  queueAndSendDeliveryReceiptEmailBatches,
  replaceDeliveryReceipt,
  retryDeliveryReceiptEmailBatch,
  saveDeliveryReceiptEmailTemplate,
  searchDeliveryReceiptOcr,
} from '@/lib/deliveryReceipts/deliveryReceiptOperationsDashboard';
import {
  deliveryReceiptFilterCatalog,
  getDeliveryReceiptFilterCatalog,
  listAllDeliveryReceipts,
  listDeliveryReceipts,
  type DeliveryReceiptRow,
} from '@/lib/deliveryReceipts/deliveryReceiptOperations';
import {defaultDeliveryReceiptCoverConfig,groupDeliveryReceiptsBySupplier} from '@/lib/deliveryReceipts/deliveryReceiptSupplier';

const mocks=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn(),upload:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mocks.rpc,functions:{invoke:mocks.invoke}}}));
vi.mock('@/lib/secureUpload',()=>({uploadSecureFile:mocks.upload}));
const tenant='20000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000001';
const receipts=Array.from({length:7},(_,index)=>`30000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`);
const now='2026-09-10T15:00:00.000Z';
function receiptRow(overrides:Partial<DeliveryReceiptRow>={}):DeliveryReceiptRow{return {
  id:crypto.randomUUID(),delivery_event_id:crypto.randomUUID(),trip_id:crypto.randomUUID(),stop_id:crypto.randomUUID(),delivered_at:now,
  captured_at:now,digital_status:'validated',physical_status:'received',email_status:'not_sent',scan_mode:'document_scan',has_original:true,
  has_processed:true,has_pdf:true,receiver_name:'Recebedor',driver:null,vehicle:null,client:null,load_ids:[],destination:'Destino',documents:[],updated_at:now,...overrides,
};}

beforeEach(()=>{vi.clearAllMocks();localStorage.clear();});

describe('delivery receipt operational completion',()=>{
  it('groups one delivery into every matching supplier without privileging CT-e',()=>{
    const row={id:receipts[0],documents:[
      {kind:'nfe',issuer_name:'Fornecedor A',issuer_tax_id:'00123456000100',supplier_id:null},
      {kind:'cte',issuer_name:'Fornecedor A',issuer_tax_id:'00.123.456/0001-00',supplier_id:null},
      {kind:'nfse',issuer_name:'Fornecedor B',issuer_tax_id:'00987654000100',supplier_id:null},
    ]} as DeliveryReceiptRow;
    const groups=groupDeliveryReceiptsBySupplier([row]);
    expect(groups.map(group=>({key:group.key,kinds:group.documentKinds,receipts:group.rows.length}))).toEqual([
      {key:'tax:00123456000100',kinds:['cte','nfe'],receipts:1},{key:'tax:00987654000100',kinds:['nfse'],receipts:1},
    ]);
  });
  it('uses the authoritative byte plan instead of fixed-count chunks for durable provider batches',async()=>{
    mocks.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>Promise.resolve(name==='plan_delivery_receipt_email_batches_v1'?{data:{version:1,
      tenant_id:tenant,actor_id:actor,supplier_key:'tax:00123456000100',receipt_count:7,source_bytes:24_000_000,
      cover_reserve_bytes_per_file:524_288,max_attachments_per_batch:5,max_attachment_bytes:5*1024*1024,max_batch_bytes:25*1024*1024,
      batches:[{items:receipts.slice(0,3).map(receipt_id=>({receipt_id,source_bytes:4_000_000,cover_reserve_bytes:524_288,projected_bytes:4_524_288})),
        source_bytes:12_000_000,projected_bytes:13_572_864},{items:receipts.slice(3).map(receipt_id=>({receipt_id,source_bytes:3_000_000,
        cover_reserve_bytes:524_288,projected_bytes:3_524_288})),source_bytes:12_000_000,projected_bytes:14_097_152}]},error:null}:{data:{version:1,batch_id:args._request_id,
      status:'queued',receipt_count:(args._receipt_ids as string[]).length,confirmed:true},error:null}));
    mocks.invoke.mockImplementation((_name:string,{body}:{body:{batch_id:string}})=>Promise.resolve({data:{batch_id:body.batch_id,
      status:'sent',provider_message_id:`provider-${body.batch_id}`,replayed:false},error:null}));
    const result=await queueAndSendDeliveryReceiptEmailBatches(tenant,actor,{supplierKey:'tax:00123456000100',supplier:'Fornecedor QA',receiptIds:receipts,
      recipients:['fiscal@fornecedor.test'],subject:'Canhotos entregues',body:'Seguem os comprovantes.',cover:defaultDeliveryReceiptCoverConfig});
    expect(result).toMatchObject({batchCount:2,receiptCount:7});
    expect(mocks.rpc.mock.calls.filter(call=>call[0]==='queue_delivery_receipt_email_v2').map(call=>(call[1]._receipt_ids as string[]).length)).toEqual([3,4]);
    expect(mocks.rpc).toHaveBeenCalledWith('plan_delivery_receipt_email_batches_v1',expect.objectContaining({_receipt_ids:receipts}));
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it('retries an existing failed batch instead of creating another queue record',async()=>{
    const batch='40000000-0000-4000-8000-000000000001';
    mocks.invoke.mockResolvedValue({data:{batch_id:batch,status:'sent',provider_message_id:'provider-retry-1',replayed:true},error:null});
    await retryDeliveryReceiptEmailBatch(tenant,batch);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith('send-delivery-receipts',{body:{tenant_id:tenant,batch_id:batch}});
  });

  it('plans more than one hundred selected receipts without truncating the filtered supplier scope',async()=>{
    const many=Array.from({length:101},(_,index)=>`30000000-0000-4000-9000-${String(index+1).padStart(12,'0')}`);
    mocks.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{if(name==='plan_delivery_receipt_email_batches_v1'){
      const ids=args._receipt_ids as string[],batches=[];for(let offset=0;offset<ids.length;offset+=5){const selected=ids.slice(offset,offset+5);
        batches.push({items:selected.map(receipt_id=>({receipt_id,source_bytes:1000,cover_reserve_bytes:0,projected_bytes:1336})),
          source_bytes:selected.length*1000,projected_bytes:selected.length*1336});}
      return Promise.resolve({data:{version:1,tenant_id:tenant,actor_id:actor,supplier_key:'tax:00123456000100',receipt_count:ids.length,
        source_bytes:ids.length*1000,cover_reserve_bytes_per_file:0,max_attachments_per_batch:5,max_attachment_bytes:5*1024*1024,
        max_batch_bytes:25*1024*1024,batches},error:null});}
      return Promise.resolve({data:{version:1,batch_id:args._request_id,status:'queued',receipt_count:(args._receipt_ids as string[]).length,confirmed:true},error:null});});
    mocks.invoke.mockImplementation((_name:string,{body}:{body:{batch_id:string}})=>Promise.resolve({data:{batch_id:body.batch_id,
      status:'sent',provider_message_id:`provider-${body.batch_id}`,replayed:false},error:null}));
    const result=await queueAndSendDeliveryReceiptEmailBatches(tenant,actor,{supplierKey:'tax:00123456000100',supplier:'Fornecedor QA',receiptIds:many,
      recipients:['fiscal@fornecedor.test'],subject:'Canhotos entregues',body:'Seguem os comprovantes.',cover:{...defaultDeliveryReceiptCoverConfig,enabled:false}});
    expect(result).toMatchObject({receiptCount:101,batchCount:21});
    expect(mocks.rpc.mock.calls.filter(call=>call[0]==='plan_delivery_receipt_email_batches_v1').map(call=>call[1]._receipt_ids.length)).toEqual([100,1]);
  });

  it('saves supplier templates and validates the tenant/actor response',async()=>{
    const template='50000000-0000-4000-8000-000000000001',now='2026-09-10T15:00:00.000Z';
    mocks.rpc.mockResolvedValue({data:{version:1,tenant_id:tenant,actor_id:actor,confirmed:true,template:{id:template,tenant_id:tenant,
      supplier_key:'tax:00123456000100',supplier_name:'Fornecedor QA',recipients:['fiscal@fornecedor.test'],subject_template:'Canhotos entregues',body_template:'Seguem os comprovantes.',
      cover_config:defaultDeliveryReceiptCoverConfig,
      template_version:1,is_active:true,created_by:actor,updated_by:actor,created_at:now,updated_at:now}},error:null});
    const result=await saveDeliveryReceiptEmailTemplate(tenant,actor,{id:template,supplierKey:'tax:00123456000100',supplier:'Fornecedor QA',
      recipients:['fiscal@fornecedor.test'],subject:'Canhotos entregues',body:'Seguem os comprovantes.',cover:defaultDeliveryReceiptCoverConfig});
    expect(result.id).toBe(template);
  });

  it('uploads an operator replacement and sends its immutable request context',async()=>{
    const requestPath=`${tenant}/delivery-replacements/${receipts[0]}/request/replacement.pdf`;
    mocks.upload.mockResolvedValue(requestPath);
    mocks.rpc.mockImplementation((_name:string,args:Record<string,unknown>)=>Promise.resolve({data:{version:1,tenant_id:tenant,actor_id:actor,
      request_id:args._request_id,previous_receipt_id:receipts[0],replacement_receipt_id:'60000000-0000-4000-8000-000000000001',
      digital_status:'pending_validation',updated_at:'2026-09-10T15:00:00.000Z',confirmed:true},error:null}));
    const row={id:receipts[0],updated_at:'2026-09-10T14:00:00.000Z'} as DeliveryReceiptRow;
    await replaceDeliveryReceipt(tenant,actor,row,new File(['%PDF'], 'replacement.pdf',{type:'application/pdf'}),'Documento corrigido');
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({tenantId:tenant,bucket:'receipts',kind:'proof'}));
    expect(mocks.rpc).toHaveBeenCalledWith('replace_delivery_receipt_v1',expect.objectContaining({_path:requestPath,_reason:'Documento corrigido'}));
  });

  it('parses the consolidated receipt, email and expense health snapshot',async()=>{
    mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{version:1,tenant_id:tenant,actor_id:actor,generated_at:now,
      receipts:{total:3,pending_validation:1,rejected:0,without_pdf:1,physical_pending:2,replaced:1},
      emails:{queued:0,sending:0,sent:1,delivered:1,bounced:0,failed:0,retryable:0},
      expenses:{pending:2,approved:1,rejected:0,without_receipt:0},templates:[],batches:[]},error:null})});
    const result=await getDeliveryReceiptOperations(tenant,actor,new AbortController().signal);
    expect(result.expenses.pending).toBe(2);expect(result.receipts.physical_pending).toBe(2);
  });

  it('loads a searchable paginated email history with immutable attachment snapshots',async()=>{
    const batch='40000000-0000-4000-8000-000000000001';mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:{version:1,
      tenant_id:tenant,actor_id:actor,rows:[{id:batch,supplier_key:'tax:00123456000100',supplier_name:'Fornecedor QA',receipt_ids:[receipts[0]],
        recipients:['fiscal@fornecedor.test'],subject:'Canhoto NF-123',body_text:'Segue comprovante.',cover_config:defaultDeliveryReceiptCoverConfig,
        status:'bounced',attempt_count:1,last_error:null,retry_after_at:null,created_at:now,updated_at:now,sent_at:now,delivered_at:null,bounced_at:now,
        items:[{receipt_id:receipts[0],file_name:'CANHOTO_FORNECEDOR_NF-123.pdf',documents:[{kind:'nfe',number:'NF-123'}]}]}],total:51,limit:25,offset:25},error:null})});
    const result=await listDeliveryReceiptEmailHistory(tenant,actor,{search:'NF-123',status:'bounced',limit:25,offset:25},new AbortController().signal);
    expect(result.rows[0]).toMatchObject({id:batch,supplier_key:'tax:00123456000100',items:[{receipt_id:receipts[0]}]});
    expect(mocks.rpc).toHaveBeenCalledWith('list_delivery_receipt_email_batches_v1',{
      _tenant_id:tenant,_search:'NF-123',_status:'bounced',_limit:25,_offset:25,
    });
  });

  it('exposes OCR health, confidence and searchable text to the operational UI',async()=>{
    mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve(name==='get_delivery_receipt_ocr_health_v1'?{data:{version:1,
      tenant_id:tenant,actor_id:actor,queued:1,processing:0,completed:2,failed:0,unavailable:3,low_confidence:1},error:null}:{data:{version:1,
      tenant_id:tenant,actor_id:actor,rows:[{receipt_id:receipts[0],status:'completed',confidence:.72,text:'NF 123 recebida',
        processed_hash:'a'.repeat(64),updated_at:now}]},error:null})}));
    expect((await getDeliveryReceiptOcrHealth(tenant,actor,new AbortController().signal).then(value=>value.unavailable))).toBe(3);
    expect(await searchDeliveryReceiptOcr(tenant,actor,'NF 123',new AbortController().signal)).toEqual([
      expect.objectContaining({receipt_id:receipts[0],confidence:.72,text:'NF 123 recebida'}),
    ]);
  });

  it('uses requested server limit/offset and validates the pagination receipt',async()=>{
    mocks.rpc.mockResolvedValue({data:{version:1,tenant_id:tenant,actor_id:actor,rows:[],total:82,limit:25,offset:50},error:null});
    const result=await listDeliveryReceipts(tenant,actor,{digital_status:'validated'},{limit:25,offset:50});
    expect(result.total).toBe(82);
    expect(mocks.rpc).toHaveBeenCalledWith('list_delivery_receipts_v1',{
      _tenant_id:tenant,_filters:{digital_status:'validated'},_limit:25,_offset:50,
    });
  });

  it('loads every server page before building complete filter options',async()=>{
    const allRows=Array.from({length:101},(_,index)=>receiptRow({
      driver:{id:crypto.randomUUID(),name:index===100?'Motorista Zulu':`Motorista ${String(index).padStart(3,'0')}`},
      vehicle:{id:crypto.randomUUID(),plate:`QA-${String(index).padStart(4,'0')}`},
    }));
    mocks.rpc.mockImplementation((_name:string,args:Record<string,unknown>)=>{const offset=Number(args._offset),limit=Number(args._limit);
      return Promise.resolve({data:{version:1,tenant_id:tenant,actor_id:actor,rows:allRows.slice(offset,offset+limit),total:allRows.length,limit,offset},error:null});});
    const result=await getDeliveryReceiptFilterCatalog(tenant,actor);
    expect(mocks.rpc.mock.calls.map(call=>call[1]._offset)).toEqual([0,100]);
    expect(result.drivers.at(-1)?.label).toBe('Motorista Zulu');
    expect(result.total).toBe(101);
  });

  it('loads every server page for the active filter without dropping duplicate rows',async()=>{
    const allRows=Array.from({length:101},()=>receiptRow());mocks.rpc.mockImplementation((_name:string,args:Record<string,unknown>)=>{
      const offset=Number(args._offset),limit=Number(args._limit);return Promise.resolve({data:{version:1,tenant_id:tenant,actor_id:actor,
        rows:allRows.slice(offset,offset+limit),total:allRows.length,limit,offset},error:null});});
    const result=await listAllDeliveryReceipts(tenant,actor,{digital_status:'validated'});
    expect(result).toHaveLength(101);expect(mocks.rpc.mock.calls.map(call=>call[1]._offset)).toEqual([0,100]);
    expect(mocks.rpc).toHaveBeenCalledWith('list_delivery_receipts_v1',expect.objectContaining({_filters:{digital_status:'validated'}}));
  });

  it('classifies all eight operational queues from canonical statuses',()=>{
    const catalog=deliveryReceiptFilterCatalog([
      receiptRow({digital_status:'pending_upload',has_pdf:false}),
      receiptRow({digital_status:'uploaded',has_pdf:false}),
      receiptRow({digital_status:'rejected',has_pdf:false}),
      receiptRow({digital_status:'validated',email_status:'queued'}),
      receiptRow({digital_status:'superseded',physical_status:'missing',has_pdf:false}),
      receiptRow({digital_status:'validated',email_status:'not_sent'}),
      receiptRow({digital_status:'validated',email_status:'delivered'}),
      receiptRow({digital_status:'validated',email_status:'bounced'}),
    ]);
    expect(catalog.queues).toEqual({awaiting_sync:1,awaiting_validation:1,rejected:1,validated:4,physical_pending:1,
      ready_to_send:1,sent:1,send_failures:1});
  });
});
