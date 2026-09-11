import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createDeliverySubmission, deliveryOutcome, invalidateDeliveryQueries, replayPendingDeliverySubmissions, type DeliverySubmissionInput } from '@/lib/driver/driverDeliverySubmission';
import { createMemoryDriverDeliveryOfflineStore, type DriverDeliveryOfflineDraft } from '@/lib/driver/driverDeliveryOfflineStore';
const mocks = vi.hoisted(() => ({
  rpc:vi.fn(),upload:vi.fn(),remove:vi.fn(),refreshSession:vi.fn(),offline:new Map<string,DriverDeliveryOfflineDraft>(),
  offlineSave:vi.fn(),offlineList:vi.fn(),offlineRemove:vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({supabase:{rpc:mocks.rpc,auth:{refreshSession:mocks.refreshSession}}}));
vi.mock('@/lib/secureUpload', () => ({uploadSecureFile:mocks.upload,removeSecureFiles:mocks.remove}));
vi.mock('@/lib/driver/driverDeliveryOfflineStore',async importOriginal=>({
  ...await importOriginal<typeof import('@/lib/driver/driverDeliveryOfflineStore')>(),
  driverDeliveryOfflineStore:{
    save:mocks.offlineSave,
    list:mocks.offlineList,
    remove:mocks.offlineRemove,
  },
}));
const result = {event_id:'10000000-0000-4000-8000-000000000001',operational_event_id:'20000000-0000-4000-8000-000000000001',replayed:false};
const file = () => new File([new Uint8Array(16)],'photo.png',{type:'image/png'});
const receiptScan=()=>({original:file(),processed:file(),capturedAt:'2026-09-10T10:00:00.000Z',scanMode:'document_scan' as const,
  crop:{left:0.02,top:0.02,right:0.98,bottom:0.98},quality:{accepted:true,sourceWidth:2000,sourceHeight:3000,
    processedWidth:1900,processedHeight:2800,brightness:180,contrast:40,sharpness:12,requiresConfirmation:false,
    glareRatio:0.01,edgeCutRisk:false,estimatedDpi:422,processingMs:25,warnings:[],rejectionReasons:[]},
  qualityPolicy:{source:'baseline' as const,policy_id:null,version:1,tenant_id:'tenant',client_id:null,
    thresholds:{min_source_pixels:2_000_000,min_processed_short_side:900,min_brightness_reject:38,min_brightness_warn:58,
      max_brightness_reject:248,max_glare_warn:.08,min_contrast_reject:8,min_contrast_warn:16,min_sharpness_reject:2,
      min_sharpness_warn:3.5,edge_cut_action:'warn' as const},resolved_at:'2026-09-10T09:59:00.000Z'}});
const input = (): DeliverySubmissionInput => ({tenantId:'tenant',actorId:'driver-user',tripId:'trip',stopId:'stop',expectedStatus:'arrived',eventKey:'entregue',
  photos:[file()],receiptScan:receiptScan(),signatureDataUrl:'data:image/png;base64,AA==',details:{receiver_name:'Recebedor',notes:'Entregue',
    latitude:-23.55052,longitude:-46.633308,accuracy_m:8,fiscal_snapshot:{version:1,tenant_id:'tenant',actor_id:'driver-user',
      trip_id:'trip',stop_id:'stop',captured_at:'2026-09-10T09:58:00.000Z',revision:'a'.repeat(32),documents:[]}}});
beforeEach(() => {
  vi.clearAllMocks();
  for(const mock of [mocks.rpc,mocks.upload,mocks.remove,mocks.refreshSession,mocks.offlineSave,mocks.offlineList,mocks.offlineRemove])mock.mockReset();
  mocks.offline.clear();
  Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
  mocks.offlineSave.mockImplementation(async(draft:DriverDeliveryOfflineDraft)=>{mocks.offline.set(draft.requestId,draft);});
  mocks.offlineList.mockImplementation(async(tenantId:string,actorId:string)=>[...mocks.offline.values()].filter(value=>value.tenantId===tenantId&&value.actorId===actorId));
  mocks.offlineRemove.mockImplementation(async(requestId:string)=>{mocks.offline.delete(requestId);});
  mocks.rpc.mockResolvedValue({data:result,error:null});
  mocks.upload.mockImplementation(async(request:{tenantId:string;folder:string;file:File;evidence:{requestId:string;slot:string;sha256:string}})=>
    `${request.tenantId}/${request.folder}/${request.evidence.requestId}-${request.evidence.slot.replace(':','-')}-${request.evidence.sha256}`);
  mocks.remove.mockResolvedValue(undefined);mocks.refreshSession.mockResolvedValue({data:{session:null},error:new Error('refresh unavailable')});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({blob:async () => new Blob([new Uint8Array(16)],{type:'image/png'})}));
});

describe('delivery frontend submission contract', () => {
  it('calls one atomic RPC with proofs, receiver and stable request id', async () => {
    const attempt=createDeliverySubmission(input()); await attempt.submit();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('driver_record_delivery_outcome',expect.objectContaining({_stop_id:'stop',_outcome:'delivered',
      _client_event_id:expect.any(String),_expected_status:'arrived',_details:expect.objectContaining({receiver_name:'Recebedor',
        photo_paths:[expect.stringContaining('/receipt/processed/'),expect.stringContaining('-photo-0-')],
        receipt_original_path:expect.stringContaining('/receipt/original/'),receipt_processed_path:expect.stringContaining('/receipt/processed/'),
        receipt_quality_policy:expect.objectContaining({source:'baseline',version:1})})}));
    expect(mocks.upload).toHaveBeenCalledTimes(4); expect(attempt.dispatched).toBe(true);
  });
  it('durably stores every proof before releasing a known-offline delivery', async () => {
    Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
    const response=await createDeliverySubmission(input()).submit();
    expect(response).toMatchObject({queued:true,stop_id:'stop',event_key:'entregue'});
    expect(mocks.offlineSave).toHaveBeenCalledTimes(1);
    const draft=[...mocks.offline.values()][0];
    expect(draft).toMatchObject({tenantId:'tenant',actorId:'driver-user',stopId:'stop',
      receiptScan:{qualityPolicy:{source:'baseline',version:1}}});
    expect(draft.photos[0].blob).toBeInstanceOf(Blob);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('never releases an offline delivery when durable storage fails', async () => {
    Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
    mocks.offlineSave.mockRejectedValueOnce(new Error('quota cheia'));
    await expect(createDeliverySubmission(input()).submit()).rejects.toThrow('quota cheia');
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('retries a lost response with identical payload, key and uploads', async () => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'Network lost'}});
    const draft=input(); const attempt=createDeliverySubmission(draft);
    await expect(attempt.submit()).resolves.toMatchObject({queued:true});
    draft.details.receiver_name='Changed'; draft.photos.push(file());
    await attempt.submit();
    expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[0]);
    expect(mocks.upload).toHaveBeenCalledTimes(4); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('replays an uncertain submission after a page reload without reuploading evidence', async () => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'Network lost'}});
    const attempt=createDeliverySubmission(input());
    await expect(attempt.submit()).resolves.toMatchObject({queued:true});
    const firstCall=mocks.rpc.mock.calls[0];
    expect([...mocks.offline.values()][0]).toMatchObject({synchronization:{stage:'dispatch_pending',
      uploads:expect.arrayContaining([expect.objectContaining({slot:'receipt:original',state:'uploaded',sha256:expect.stringMatching(/^[a-f0-9]{64}$/)})])}});
    mocks.rpc.mockResolvedValueOnce({data:{...result,replayed:true},error:null});
    await expect(replayPendingDeliverySubmissions('tenant','driver-user')).resolves.toEqual({confirmed:1,cleaned:0,rejected:0,pending:0,needsAttention:0,pendingStopIds:[]});
    expect(mocks.rpc.mock.calls[1]).toEqual(firstCall);
    expect(mocks.upload).toHaveBeenCalledTimes(4);
    expect(mocks.offline.size).toBe(0);
  });
  it('does not replay another actor or tenant outbox', async () => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'Network lost'}});
    await expect(createDeliverySubmission(input()).submit()).resolves.toMatchObject({queued:true});
    await expect(replayPendingDeliverySubmissions('tenant','other-driver')).resolves.toEqual({confirmed:0,cleaned:0,rejected:0,pending:0,needsAttention:0,pendingStopIds:[]});
    await expect(replayPendingDeliverySubmissions('other-tenant','driver-user')).resolves.toEqual({confirmed:0,cleaned:0,rejected:0,pending:0,needsAttention:0,pendingStopIds:[]});
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.offline.size).toBe(1);
    expect([...mocks.offline.values()][0]).toMatchObject({synchronization:{stage:'dispatch_pending'}});
  });
  it('waits for an earlier operational command before replaying the delivery', async () => {
    const store=createMemoryDriverDeliveryOfflineStore();
    const hasPendingPredecessor=vi.fn().mockResolvedValue(true);
    store.hasPendingPredecessor=hasPendingPredecessor;
    Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
    await createDeliverySubmission(input(),{offlineStore:store}).submit();
    Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
    await expect(replayPendingDeliverySubmissions('tenant','driver-user',store)).resolves.toMatchObject({confirmed:0,pending:1});
    expect(hasPendingPredecessor).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('deduplicates concurrent button submissions', async () => {
    const attempt=createDeliverySubmission(input()); const first=attempt.submit(); const second=attempt.submit();
    expect(first).toBe(second); await Promise.all([first,second]); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['22023','23514','40001'])('preserves every proof and marks a confirmed %s conflict for review', async code => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code,message:'Envio rejeitado'}});
    const attempt=createDeliverySubmission(input());
    await expect(attempt.submit()).resolves.toMatchObject({queued:true});
    expect(attempt.canRevise).toBe(false);expect(mocks.remove).not.toHaveBeenCalled();
    expect([...mocks.offline.values()][0]).toMatchObject({state:'needs_attention',attention:{kind:'remote_conflict',code}});
  });
  it.each(['23505','PGRST000','',undefined])('keeps an unclassified %s response immutable', async code => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code,message:'Resultado incerto'}});
    const attempt=createDeliverySubmission(input());
    await expect(attempt.submit()).resolves.toMatchObject({queued:true});
    expect(attempt.canRevise).toBe(false); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('does not erase evidence after a lost response followed by a validation rejection', async () => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'Resposta perdida'}})
      .mockResolvedValueOnce({data:null,error:{code:'23514',message:'Parada já encerrada'}});
    const attempt=createDeliverySubmission(input());
    await expect(attempt.submit()).resolves.toMatchObject({queued:true});
    await expect(attempt.submit()).resolves.toMatchObject({queued:true});
    expect(attempt.canRevise).toBe(false); expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[0]);
  });
  it('keeps an exception from transport uncertain even if the retry is rejected', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('Conexão interrompida'))
      .mockResolvedValueOnce({data:null,error:{code:'42501',message:'Sessão expirada'}});
    const attempt=createDeliverySubmission(input());
    await expect(attempt.submit()).resolves.toMatchObject({queued:true});
    await expect(attempt.submit()).resolves.toMatchObject({queued:true});
    expect(attempt.canRevise).toBe(false); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('quarantines an explicit fiscal reallocation response without deleting uploaded evidence',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{version:1,confirmed:false,conflict:true,
      error_code:'delivery_fiscal_snapshot_changed',request_id:'a0000000-0000-4000-8000-000000000001'},error:null});
    await expect(createDeliverySubmission(input(),{requestId:'a0000000-0000-4000-8000-000000000001'}).submit())
      .resolves.toMatchObject({queued:true,needs_attention:true,attention_code:'delivery_fiscal_snapshot_changed'});
    expect([...mocks.offline.values()][0]).toMatchObject({state:'needs_attention',attention:{kind:'remote_conflict',
      code:'delivery_fiscal_snapshot_changed'}});
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('keeps all evidence queued when the access token expired before the first RPC',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'42501',message:'JWT expired'}});
    const attempt=createDeliverySubmission(input());
    await expect(attempt.submit()).resolves.toMatchObject({queued:true});
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(attempt.canRevise).toBe(false);
  });
  it.each(['40001','40P01','42501','P0002'])('preserves evidence when %s may mean a remote change or transient conflict',async code=>{
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code,message:'Estado remoto alterado'}});
    const attempt=createDeliverySubmission(input());
    await expect(attempt.submit()).resolves.toMatchObject({queued:true});
    expect(mocks.remove).not.toHaveBeenCalled();expect(attempt.canRevise).toBe(false);
  });
  it('does not automatically retry a remote conflict or remove its evidence', async () => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'23514',message:'Envio rejeitado'}});
    await expect(createDeliverySubmission(input()).submit()).resolves.toMatchObject({queued:true});
    await expect(replayPendingDeliverySubmissions('tenant','driver-user')).resolves.toMatchObject({confirmed:0,rejected:1,needsAttention:1});
    expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('never removes potentially committed evidence on a malformed success response', async () => {
    mocks.rpc.mockResolvedValue({data:{},error:null});
    await expect(createDeliverySubmission(input()).submit()).resolves.toMatchObject({queued:true});
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('preserves the per-file ledger when a later upload fails', async () => {
    const implementation=mocks.upload.getMockImplementation()!;mocks.upload.mockImplementationOnce(implementation).mockRejectedValueOnce(new Error('upload failed'));
    const attempt=createDeliverySubmission({...input(),photos:[file(),file()]});
    await expect(attempt.submit()).resolves.toMatchObject({queued:true});
    expect(mocks.remove).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();expect(attempt.dispatched).toBe(false);
    expect([...mocks.offline.values()][0].synchronization?.uploads?.[0]).toMatchObject({slot:'receipt:original',state:'uploaded',path:expect.any(String)});
    expect([...mocks.offline.values()][0].uploadFailures).toBe(1);
  });
  it.each([1,2,3])('resumes after %i completed uploads without resending completed slots',async completed=>{
    const upload=mocks.upload.getMockImplementation()!;let call=0;
    mocks.upload.mockImplementation(async request=>{call+=1;if(call===completed+1)throw new Error('interrupted between files');return upload(request);});
    await expect(createDeliverySubmission(input()).submit()).resolves.toMatchObject({queued:true});
    const saved=[...mocks.offline.values()][0];
    expect(saved.uploadFailures).toBe(1);
    expect(saved.synchronization?.uploads?.filter(entry=>entry.state==='uploaded')).toHaveLength(completed);
    mocks.upload.mockImplementation(upload);
    await expect(replayPendingDeliverySubmissions('tenant','driver-user')).resolves.toMatchObject({confirmed:1,pending:0});
    expect(mocks.upload).toHaveBeenCalledTimes(5);
    const slots=mocks.upload.mock.calls.map(([request])=>(request as {evidence:{slot:string}}).evidence.slot);
    for(const slot of slots.slice(0,completed))expect(slots.filter(value=>value===slot)).toHaveLength(1);
  });
  it.each(['hash','path'])('quarantines a resumed draft with an incompatible %s and uploads nothing',async mismatch=>{
    Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
    await createDeliverySubmission(input()).submit();
    const saved=[...mocks.offline.values()][0],entry=saved.synchronization!.uploads![0];
    entry.state='uploaded';
    if(mismatch==='hash')entry.sha256='a'.repeat(64);
    entry.path=mismatch==='path'?'other-tenant/deliveries/wrong.png':
      `tenant/deliveries/trip/stop/receipt/original/${saved.requestId}-receipt-original-${entry.sha256}`;
    Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
    await expect(replayPendingDeliverySubmissions('tenant','driver-user')).resolves.toMatchObject({confirmed:0,pending:1,needsAttention:1});
    expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
    expect([...mocks.offline.values()][0]).toMatchObject({state:'needs_attention',attention:{kind:'local_evidence_conflict',slot:'receipt:original'}});
  });
  it('refreshes one expired RPC session and retries the exact idempotent command',async()=>{
    mocks.refreshSession.mockResolvedValueOnce({data:{session:{access_token:'renewed'}},error:null});
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'42501',message:'JWT expired'}}).mockResolvedValueOnce({data:result,error:null});
    await expect(createDeliverySubmission(input()).submit()).resolves.toMatchObject({queued:false});
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[0]);expect(mocks.offline.size).toBe(0);
  });
  it('refreshes and safely retries a 401 upload against the same deterministic slot',async()=>{
    const upload=mocks.upload.getMockImplementation()!;
    mocks.refreshSession.mockResolvedValueOnce({data:{session:{access_token:'renewed'}},error:null});
    mocks.upload.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'),{status:401})).mockImplementation(upload);
    await expect(createDeliverySubmission(input()).submit()).resolves.toMatchObject({queued:false});
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);expect(mocks.upload).toHaveBeenCalledTimes(5);
    expect(mocks.upload.mock.calls[1][0]).toMatchObject({evidence:mocks.upload.mock.calls[0][0].evidence});
  });
  it('coordinates one refresh across concurrent expired delivery commands',async()=>{
    let release!:(value:{data:{session:{access_token:string}};error:null})=>void;
    mocks.refreshSession.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const attempts=new Map<string,number>();
    mocks.rpc.mockImplementation(async(_name:string,args:{_client_event_id:string})=>{
      const count=(attempts.get(args._client_event_id)??0)+1;attempts.set(args._client_event_id,count);
      return count===1?{data:null,error:{code:'42501',message:'JWT expired'}}:{data:result,error:null};
    });
    const first=createDeliverySubmission(input()).submit();
    const second=createDeliverySubmission({...input(),stopId:'stop-2'}).submit();
    await vi.waitFor(()=>expect(mocks.refreshSession).toHaveBeenCalledTimes(1));
    release({data:{session:{access_token:'renewed'}},error:null});
    await expect(Promise.all([first,second])).resolves.toEqual([expect.objectContaining({queued:false}),expect.objectContaining({queued:false})]);
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);expect(mocks.rpc).toHaveBeenCalledTimes(4);
  });
  it('marks an existing-object upload mismatch for attention without deleting evidence',async()=>{
    mocks.upload.mockRejectedValueOnce(Object.assign(new Error('existing object mismatch'),{status:409,
      code:'delivery_evidence_existing_object_mismatch'}));
    await expect(createDeliverySubmission(input()).submit()).resolves.toMatchObject({queued:true});
    expect([...mocks.offline.values()][0]).toMatchObject({state:'needs_attention',attention:{kind:'local_evidence_conflict',
      code:'delivery_evidence_existing_object_mismatch',slot:'receipt:original'}});
    expect(mocks.remove).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('cleans photos when signature upload fails and reports cleanup failures', async () => {
    mocks.upload.mockResolvedValueOnce('original.png').mockResolvedValueOnce('processed.png')
      .mockResolvedValueOnce('photo.png').mockRejectedValueOnce(new Error('signature failed'));
    mocks.remove.mockRejectedValue(new Error('cleanup failed'));
    await expect(createDeliverySubmission(input()).submit()).resolves.toMatchObject({queued:true});
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['entregue','devolucao_parcial'])('requires signature and an accepted receipt scan for %s before uploading', eventKey => {
    expect(() => createDeliverySubmission({...input(),eventKey,receiptScan:null})).toThrow('canhoto legível');
    expect(() => createDeliverySubmission({...input(),eventKey,receiptScan:{...receiptScan(),quality:{...receiptScan().quality,accepted:false}}})).toThrow('canhoto legível');
    expect(() => createDeliverySubmission({...input(),eventKey,signatureDataUrl:null})).toThrow('canhoto legível');
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it.each(['entregue','devolucao_parcial'])('requires a valid GPS snapshot for %s before durable release', eventKey => {
    expect(() => createDeliverySubmission({...input(),eventKey,details:{receiver_name:'Recebedor',notes:'Entregue'}})).toThrow('localização GPS válida');
    expect(mocks.offlineSave).not.toHaveBeenCalled();
  });
  it.each(['devolucao_total','cliente_recusou'])('requires photographic evidence for %s', eventKey => {
    expect(() => createDeliverySubmission({...input(),eventKey,photos:[]})).toThrow('comprovar a recusa ou devolução total');
    expect(mocks.offlineSave).not.toHaveBeenCalled();
  });
  it.each(['devolucao_total','cliente_recusou'])('requires returned item evidence for %s before uploading', eventKey => {
    expect(() => createDeliverySubmission({...input(),eventKey})).toThrow('Marque todos os itens');
    expect(mocks.offlineSave).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it.each(['devolucao_parcial','devolucao_total','cliente_recusou','cliente_estava_fora'])('routes %s directly to the outcome API', async eventKey => {
    const draft={...input(),eventKey,details:{...input().details,
      ...(['devolucao_total','cliente_recusou'].includes(eventKey)?{returned_items:{'item-1':1}}:{})}};
    await createDeliverySubmission(draft).submit();
    expect(mocks.rpc).toHaveBeenCalledWith('driver_record_delivery_outcome',expect.objectContaining({_outcome:deliveryOutcome(eventKey)}));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['avaria','solicitar_desconto','atualizar_boleto','coleta_realizada','outros'])('sends %s to operations, not a dispatch-only event', async eventKey => {
    await createDeliverySubmission({...input(),eventKey}).submit();
    expect(mocks.rpc).toHaveBeenCalledWith('driver_record_delivery_note',expect.objectContaining({_event_type:eventKey}));
  });
  it('invalidates interconnected load, trip, documents, driver and operations caches', async () => {
    const client=new QueryClient(); const spy=vi.spyOn(client,'invalidateQueries').mockResolvedValue();
    await invalidateDeliveryQueries(client);
    for (const key of ['driver_delivery_stops','driver_events','driver_active_trip','loads','fiscal_documents','operational_events','dispatch_trips',
      'load_documents','operation_document_context','driver_settlements','driver_settlement','portal_pods','portal_shipments','portal_shipment_detail_v2']) {
      expect(spy).toHaveBeenCalledWith({queryKey:[key]});
    }
    client.clear();
  });
  it('does not convert a committed delivery into a failure when one refresh rejects', async () => {
    const client=new QueryClient(); const spy=vi.spyOn(client,'invalidateQueries').mockRejectedValueOnce(new Error('Refresh unavailable')).mockResolvedValue();
    await expect(invalidateDeliveryQueries(client)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith({queryKey:['portal_shipment_detail_v2']});
    expect(spy).toHaveBeenCalledWith({queryKey:['driver_events']});
    client.clear();
  });
});
