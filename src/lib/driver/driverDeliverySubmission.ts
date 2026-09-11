import { z } from 'zod';
import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { uploadSecureFile } from '@/lib/secureUpload';
import { readBlobBytes, validateUploadFile } from '@/lib/uploadPolicy';
import { invalidateCompositionQueries } from '@/lib/loads/compositionMutation';
import { isReceiptScanAcceptable, type ReceiptScanResult } from '@/lib/driver/receiptScan';
import {
  driverDeliveryOfflineStore,
  driverDeliveryScope,
  restoreDriverFile,
  restoreReceiptScan,
  storeDriverFile,
  type DriverDeliveryAttention,
  type DriverDeliveryOfflineDraft,
  type DriverDeliveryOfflineStore,
  type DriverDeliveryUploadLedgerEntry,
} from '@/lib/driver/driverDeliveryOfflineStore';

const outcomes: Record<string, string> = {
  entregue: 'delivered', devolucao_parcial: 'partial_delivery', devolucao_total: 'returned',
  cliente_recusou: 'refused', cliente_estava_fora: 'failed',
};
const noteTypes = new Set(['avaria','solicitar_desconto','atualizar_boleto','coleta_realizada','outros']);
const resultSchema = z.object({event_id:z.string().uuid(), operational_event_id:z.string().uuid(), replayed:z.boolean()}).passthrough();
const fiscalConflictSchema=z.object({confirmed:z.literal(false),conflict:z.literal(true),
  error_code:z.literal('delivery_fiscal_snapshot_changed'),request_id:z.string().uuid()}).passthrough();
const fiscalConflictResolutionSchema=z.object({version:z.literal(1),request_id:z.string().uuid(),
  status:z.enum(['pending','resolved']),resolution_action:z.enum(['discard']).nullable(),replacement_required:z.boolean()});
const queuedResultSchema = z.object({
  queued:z.literal(true), request_id:z.string().uuid(), stop_id:z.string().min(1), event_key:z.string().min(1),
  needs_attention:z.boolean(), attention_code:z.string().nullable(),
});
export type DeliverySubmissionResult = (z.infer<typeof resultSchema> & {queued:false}) | z.infer<typeof queuedResultSchema>;
const definitiveRemoteConflicts = new Set(['22023','23514','23505','40001','PT409']);
let sessionRefresh:Promise<boolean>|null=null;

function errorCode(error:unknown):string|null {
  if(!error||typeof error!=='object')return null;
  const value=error as {code?:unknown;status?:unknown;context?:{status?:unknown}};
  if(typeof value.code==='string'&&value.code)return value.code;
  const status=typeof value.status==='number'?value.status:value.context?.status;
  return typeof status==='number'?String(status):null;
}

function isAuthorizationFailure(error:unknown):boolean {
  const code=errorCode(error),message=deliveryErrorMessage(error);
  return code==='401'||code==='42501'||/\b(jwt|token|sess[aã]o)\b.*\b(expir|invalid|ausente)|unauthorized/i.test(message);
}

function isRemoteConflict(error:unknown):boolean {
  const code=errorCode(error);
  return code==='409'||code==='delivery_evidence_hash_mismatch'||code==='delivery_evidence_existing_object_mismatch'
    ||(code!==null&&definitiveRemoteConflicts.has(code));
}

async function refreshSessionCoordinated():Promise<boolean>{
  const refresh=supabase.auth?.refreshSession?.bind(supabase.auth);
  if(!refresh)return false;
  if(!sessionRefresh)sessionRefresh=(async()=>{
    try{const response=await refresh();return !response.error&&!!response.data.session;}
    catch{return false;}
  })().finally(()=>{sessionRefresh=null;});
  return sessionRefresh;
}

async function retryAfterSessionRefresh<T>(operation:()=>Promise<T>,failed:(value:T)=>unknown|null):Promise<T>{
  try{
    const first=await operation();const firstFailure=failed(first);
    if(!firstFailure||!isAuthorizationFailure(firstFailure)||!await refreshSessionCoordinated())return first;
    return operation();
  }catch(error){
    if(!isAuthorizationFailure(error)||!await refreshSessionCoordinated())throw error;
    return operation();
  }
}
export interface DeliverySubmissionInput {
  tenantId: string; actorId: string; tripId: string; stopId: string; expectedStatus: string; eventKey: string;
  photos: File[]; receiptScan: ReceiptScanResult | null; signatureDataUrl: string | null; details: Record<string, Json>;
  signatureFile?: File | null;
}

interface DeliverySubmissionOptions {
  requestId?: string;
  offlineStore?: DriverDeliveryOfflineStore;
  durableDraft?: DriverDeliveryOfflineDraft;
}

export function deliveryOutcome(eventKey: string) { return outcomes[eventKey]; }
export function deliveryErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Não foi possível confirmar o envio. Tente novamente com os mesmos dados.';
}

function isKnownOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function signatureFileFromDataUrl(dataUrl: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], 'assinatura.png', { type: blob.type || 'image/png' });
}

async function deliveryFileHash(file:Blob):Promise<string>{
  if(!globalThis.crypto?.subtle)throw new Error('Este aparelho não oferece verificação segura dos arquivos.');
  const bytes=await readBlobBytes(file);const digest=await globalThis.crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function inputFromOfflineDraft(draft: DriverDeliveryOfflineDraft): DeliverySubmissionInput {
  return {
    tenantId:draft.tenantId, actorId:draft.actorId, tripId:draft.tripId, stopId:draft.stopId,
    expectedStatus:draft.expectedStatus, eventKey:draft.eventKey, details:structuredClone(draft.details),
    photos:draft.photos.map(restoreDriverFile), receiptScan:restoreReceiptScan(draft.receiptScan),
    signatureDataUrl:null, signatureFile:draft.signature ? restoreDriverFile(draft.signature) : null,
  };
}

export async function listPendingDeliverySubmissions(
  tenantId: string,
  actorId: string,
  offlineStore: DriverDeliveryOfflineStore = driverDeliveryOfflineStore,
) {
  const drafts = await offlineStore.list(tenantId, actorId);
  return drafts.map(draft => ({
    requestId:draft.requestId, tripId:draft.tripId, stopId:draft.stopId, eventKey:draft.eventKey,
    outcome:draft.outcome, createdAt:draft.createdAt,state:draft.state??'queued',attention:draft.attention??null,
    fileCount:draft.photos.length + (draft.receiptScan ? (draft.receiptScan.thumbnail?3:2) : 0) + (draft.signature ? 1 : 0),
    bytes:[...draft.photos,draft.receiptScan?.original,draft.receiptScan?.processed,draft.receiptScan?.thumbnail,draft.signature]
      .reduce((total,file) => total + (file?.blob.size ?? 0),0),
  }));
}

type FiscalConflictRpcResult=PromiseLike<{data:unknown;error:{message?:string}|null}>;
const fiscalConflictRpc=supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>FiscalConflictRpcResult;

export async function discardResolvedDeliverySubmission(
  tenantId:string,
  actorId:string,
  requestId:string,
  offlineStore:DriverDeliveryOfflineStore=driverDeliveryOfflineStore,
):Promise<{discarded:boolean;pending:boolean}>{
  const draft=(await offlineStore.list(tenantId,actorId)).find(row=>row.requestId===requestId);
  if(!draft||draft.state!=='needs_attention'||draft.attention?.code!=='delivery_fiscal_snapshot_changed'){
    throw new Error('A tentativa fiscal não está disponível para revisão neste aparelho.');
  }
  const {data,error}=await fiscalConflictRpc('get_driver_delivery_fiscal_conflict_v1',{
    _tenant_id:tenantId,_request_id:requestId,
  });
  if(error)throw error;
  const decision=fiscalConflictResolutionSchema.parse(data);
  if(decision.status==='pending')return {discarded:false,pending:true};
  if(decision.resolution_action!=='discard'||!decision.replacement_required){
    throw new Error('A decisão operacional não permite descartar esta tentativa.');
  }
  await offlineStore.remove(requestId);
  return {discarded:true,pending:false};
}

export async function replayPendingDeliverySubmissions(
  tenantId: string,
  actorId: string,
  offlineStore: DriverDeliveryOfflineStore = driverDeliveryOfflineStore,
) {
  let confirmed=0;
  const cleaned=0;
  let rejected=0;
  const drafts = await offlineStore.list(tenantId, actorId);
  for (const draft of drafts) {
    if(draft.state==='needs_attention'&&draft.attention?.kind!=='authorization'){rejected+=1;continue;}
    if (await offlineStore.hasPendingPredecessor?.(draft)) continue;
    try {
      const result = await createDeliverySubmission(inputFromOfflineDraft(draft), {
        requestId:draft.requestId, offlineStore, durableDraft:draft,
      }).submit();
      if (!result.queued) confirmed+=1;
    } catch {
      rejected+=1;
    }
  }
  const remaining = await offlineStore.list(tenantId, actorId);
  return {
    confirmed, cleaned, rejected, pending:remaining.length,
    needsAttention:remaining.filter(draft=>draft.state==='needs_attention').length,
    pendingStopIds:[...new Set(remaining.map(draft => draft.stopId))],
  };
}

/**
 * The immutable IndexedDB draft is written before the first network operation.
 * A queued result only releases the UI after every proof byte and the idempotency key
 * are durable on the device. Upload progress and the server payload remain in the
 * same IndexedDB outbox record, so a lost response does not re-upload evidence.
 */
export function createDeliverySubmission(input: DeliverySubmissionInput, options: DeliverySubmissionOptions = {}) {
  const {tenantId,actorId,tripId,stopId,eventKey,expectedStatus} = input;
  const outcome = deliveryOutcome(eventKey);
  const offlineStore = options.offlineStore ?? driverDeliveryOfflineStore;
  if (!tenantId || !actorId || !tripId || !stopId || (!outcome && !noteTypes.has(eventKey))) throw new Error('Evento ou viagem inválidos.');
  const details = structuredClone(input.details);
  const photos = [...input.photos];
  const requiresReceipt = outcome === 'delivered' || outcome === 'partial_delivery';
  const requiresOutcomePhoto = outcome === 'returned' || outcome === 'refused';
  const receiptScan = requiresReceipt?input.receiptScan:null;
  const signatureDataUrl = input.signatureDataUrl;
  let signatureFile = input.signatureFile ?? null;
  if (photos.length > (requiresReceipt?4:5)) throw new Error(requiresReceipt?'Envie no máximo quatro fotos adicionais.':'Envie no máximo cinco fotos.');
  photos.forEach(file => validateUploadFile(file,'image'));
  if (signatureFile) validateUploadFile(signatureFile,'image');
  if (requiresReceipt) {
    if (typeof details.receiver_name !== 'string' || details.receiver_name.trim().length < 2) throw new Error('Informe o recebedor.');
    if (!isReceiptScanAcceptable(receiptScan) || (!signatureDataUrl && !signatureFile)) throw new Error('Digitalize um canhoto legível e capture a assinatura para comprovar a entrega.');
    const latitude=details.latitude,longitude=details.longitude,accuracy=details.accuracy_m;
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 150) {
      throw new Error('Obtenha uma localização GPS válida para confirmar a entrega.');
    }
  }
  if (outcome !== 'delivered' && (typeof details.notes !== 'string' || details.notes.trim().length < 3)) {
    throw new Error('Informe o motivo ou a descrição da comunicação.');
  }
  if ((eventKey === 'avaria' || eventKey === 'coleta_realizada') && !photos.length) throw new Error('Adicione uma foto.');
  if (requiresOutcomePhoto && !photos.length) throw new Error('Adicione uma foto para comprovar a recusa ou devolução total.');
  if (requiresOutcomePhoto) {
    const returnedItems = details.returned_items;
    if (!returnedItems || typeof returnedItems !== 'object' || Array.isArray(returnedItems)
      || !Object.values(returnedItems).some((quantity) => typeof quantity === 'number' && quantity > 0)) {
      throw new Error('Marque todos os itens devolvidos ou recusados antes de enviar.');
    }
  }
  const requestId = options.requestId ?? crypto.randomUUID();
  let prepared: Record<string, Json> | null = options.durableDraft?.synchronization?.preparedDetails ?? null;
  let dispatched = false;
  let canRevise = true;
  let durableDraft = options.durableDraft ?? null;
  let durableSaved = !!options.durableDraft;
  let inFlight: Promise<DeliverySubmissionResult> | null = null;
  let uploads:DriverDeliveryUploadLedgerEntry[] = structuredClone(options.durableDraft?.synchronization?.uploads??[]);
  let uploadFailures=options.durableDraft?.uploadFailures??0;
  const createdAt = durableDraft?.createdAt ?? new Date().toISOString();

  type PlannedUpload={slot:string;file:File;folder:string;declaredHash?:string};
  const plannedUploads=():PlannedUpload[]=>[
    ...(receiptScan?[{slot:'receipt:original',file:receiptScan.original,folder:`deliveries/${tripId}/${stopId}/receipt/original`,declaredHash:receiptScan.originalHash},
      {slot:'receipt:processed',file:receiptScan.processed,folder:`deliveries/${tripId}/${stopId}/receipt/processed`,declaredHash:receiptScan.processedHash},
      ...(receiptScan.thumbnail?[{slot:'receipt:thumbnail',file:receiptScan.thumbnail,folder:`deliveries/${tripId}/${stopId}/receipt/thumbnail`,declaredHash:receiptScan.thumbnailHash}]:[])]:[]),
    ...photos.map((file,index)=>({slot:`photo:${index}`,file,folder:`deliveries/${tripId}/${stopId}`})),
    ...(signatureFile?[{slot:'signature',file:signatureFile,folder:`deliveries/${tripId}/${stopId}/signatures`}]:[]),
  ];

  const uploadedPaths=()=>uploads.filter(entry=>entry.state==='uploaded'&&entry.path).map(entry=>entry.path!);

  async function persist(
    stage:NonNullable<DriverDeliveryOfflineDraft['synchronization']>['stage'],
    storedDetails:Record<string,Json>|null=prepared,
    state:DriverDeliveryOfflineDraft['state']=durableDraft?.state??'queued',
    attention:DriverDeliveryAttention|null=durableDraft?.attention??null,
  ) {
    if(!durableDraft)throw new Error('O envio não possui registro offline durável.');
    durableDraft={...durableDraft,state,attention,uploadFailures,synchronization:{stage,uploadedPaths:uploadedPaths(),preparedDetails:storedDetails,
      uploads:structuredClone(uploads)},updatedAt:new Date().toISOString()};
    await offlineStore.save(durableDraft);
  }

  async function markAttention(kind:DriverDeliveryAttention['kind'],cause:unknown,entry?:DriverDeliveryUploadLedgerEntry,
    actualSha256:string|null=null,path:string|null=entry?.path??null){
    if(entry)entry.state='needs_attention';
    const attention:DriverDeliveryAttention={kind,code:errorCode(cause),message:deliveryErrorMessage(cause).slice(0,500),
      slot:entry?.slot??null,expectedSha256:entry?.sha256??null,actualSha256,path,recordedAt:new Date().toISOString()};
    await persist('needs_attention',prepared,'needs_attention',attention);
    canRevise=false;
  }

  function pathMatchesLedger(path:string,entry:DriverDeliveryUploadLedgerEntry):boolean{
    const prefix=`${tenantId}/deliveries/${tripId}/${stopId}/`;
    return path.startsWith(prefix)&&path.endsWith(`/${requestId}-${entry.slot.replace(':','-')}-${entry.sha256}`);
  }

  async function ensureDurableDraft() {
    if (!signatureFile && signatureDataUrl) signatureFile = await signatureFileFromDataUrl(signatureDataUrl);
    const plan=plannedUploads();
    const actual=await Promise.all(plan.map(async item=>({...item,sha256:await deliveryFileHash(item.file)})));
    if (!durableDraft) {
      const now = new Date().toISOString();
      uploads=actual.map(item=>({slot:item.slot,sha256:item.sha256,path:null,state:'pending'}));
      durableDraft = {
        version:1, requestId, scopeKey:driverDeliveryScope(tenantId, actorId), tenantId, actorId, tripId, stopId,
        expectedStatus, eventKey, outcome:outcome ?? null, details:structuredClone(details),
        photos:photos.map((file,index)=>({...storeDriverFile(file),sha256:actual.find(item=>item.slot===`photo:${index}`)!.sha256})),
        receiptScan:receiptScan ? {
          original:{...storeDriverFile(receiptScan.original),sha256:actual.find(item=>item.slot==='receipt:original')!.sha256},
          processed:{...storeDriverFile(receiptScan.processed),sha256:actual.find(item=>item.slot==='receipt:processed')!.sha256},
          thumbnail:receiptScan.thumbnail?{...storeDriverFile(receiptScan.thumbnail),sha256:actual.find(item=>item.slot==='receipt:thumbnail')!.sha256}:undefined,
          originalHash:actual.find(item=>item.slot==='receipt:original')!.sha256,
          processedHash:actual.find(item=>item.slot==='receipt:processed')!.sha256,
          thumbnailHash:actual.find(item=>item.slot==='receipt:thumbnail')?.sha256,
          capturedAt:receiptScan.capturedAt, scanMode:receiptScan.scanMode,
          crop:structuredClone(receiptScan.crop),corners:receiptScan.corners?structuredClone(receiptScan.corners):undefined,
          rotation:receiptScan.rotation,quality:structuredClone(receiptScan.quality),
          qualityPolicy:receiptScan.qualityPolicy?structuredClone(receiptScan.qualityPolicy):undefined,
          qualityConfirmed:receiptScan.qualityConfirmed,
        } : null,
        signature:signatureFile ? {...storeDriverFile(signatureFile),sha256:actual.find(item=>item.slot==='signature')!.sha256} : null,
        state:'queued',uploadFailures:0,attention:null,synchronization:{stage:'queued',uploadedPaths:[],preparedDetails:null,uploads},
        createdAt, updatedAt:now,
      };
    }
    if (!durableSaved) {
      await offlineStore.save(durableDraft);
      durableSaved=true;
    }
    if(!options.durableDraft)return;
    if(!uploads.length&&(options.durableDraft.synchronization?.uploadedPaths.length??0)>0){
      await markAttention('local_evidence_conflict',new Error('O envio antigo possui uploads sem vínculo verificável com os arquivos.'));
      throw new Error('O ledger dos anexos precisa de conferência operacional.');
    }
    if(!uploads.length){uploads=actual.map(item=>({slot:item.slot,sha256:item.sha256,path:null,state:'pending'}));await persist('queued',null,'queued',null);}
    const slots=new Set(uploads.map(entry=>entry.slot));
    if(slots.size!==uploads.length||uploads.length!==actual.length||actual.some(item=>!slots.has(item.slot))){
      await markAttention('local_evidence_conflict',new Error('Os slots dos anexos não correspondem ao rascunho salvo.'));
      throw new Error('Os anexos salvos precisam de conferência operacional.');
    }
    for(const item of actual){
      const entry=uploads.find(candidate=>candidate.slot===item.slot)!;
      if(entry.sha256!==item.sha256||item.declaredHash&&item.declaredHash!==item.sha256){
        await markAttention('local_evidence_conflict',new Error('O conteúdo do anexo difere do hash salvo.'),entry,item.sha256);
        throw new Error('Um anexo salvo foi alterado e precisa de conferência operacional.');
      }
      if(entry.state==='uploaded'&&(!entry.path||!pathMatchesLedger(entry.path,entry))){
        await markAttention('local_evidence_conflict',new Error('O caminho remoto não corresponde ao slot e hash salvos.'),entry,item.sha256,entry.path);
        throw new Error('O caminho de um anexo precisa de conferência operacional.');
      }
    }
  }

  function queuedResult(): DeliverySubmissionResult {
    canRevise=false;
    return queuedResultSchema.parse({queued:true,request_id:requestId,stop_id:stopId,event_key:eventKey,
      needs_attention:durableDraft?.state==='needs_attention',attention_code:durableDraft?.attention?.code??null});
  }

  async function prepare() {
    if(durableDraft?.state==='needs_attention'&&durableDraft.attention?.kind!=='authorization')throw new Error(durableDraft.attention?.message??'Envio requer conferência.');
    if (prepared) return prepared;
    const plan=plannedUploads();
    for(const item of plan){
      const entry=uploads.find(candidate=>candidate.slot===item.slot)!;
      if(entry.state==='uploaded')continue;
      try{
        const path=await retryAfterSessionRefresh(
          ()=>uploadSecureFile({tenantId,bucket:'receipts',folder:item.folder,file:item.file,kind:'image',
            evidence:{requestId,slot:item.slot,sha256:entry.sha256}}),
          ()=>null,
        );
        if(!pathMatchesLedger(path,entry)){
          await markAttention('local_evidence_conflict',new Error('O gateway retornou um caminho incompatível com o anexo.'),entry,entry.sha256,path);
          throw new Error('O caminho retornado pelo upload precisa de conferência operacional.');
        }
        entry.path=path;entry.state='uploaded';
        await persist('preparing',null,'queued',null);
      }catch(error){
        uploadFailures+=1;
        if(durableDraft?.state!=='needs_attention'&&isAuthorizationFailure(error))await markAttention('authorization',error,entry);
        else if(durableDraft?.state!=='needs_attention'&&isRemoteConflict(error))await markAttention('local_evidence_conflict',error,entry,entry.sha256,entry.path);
        else if(durableDraft?.state!=='needs_attention')await persist('preparing',null,'queued',null);
        throw error;
      }
    }
    const path=(slot:string)=>uploads.find(entry=>entry.slot===slot)?.path??null;
    const paths=photos.map((_,index)=>path(`photo:${index}`)).filter((value):value is string=>!!value);
    const receiptOriginal=path('receipt:original'),receiptProcessed=path('receipt:processed'),receiptThumbnail=path('receipt:thumbnail');
    const signature=path('signature');
      const evidencePaths=receiptProcessed?[receiptProcessed,...paths]:paths;
      prepared = {...details,photo_paths:evidencePaths,photo_count:evidencePaths.length,signature_path:signature,
        receipt_original_path:receiptOriginal,receipt_processed_path:receiptProcessed,
        receipt_thumbnail_path:receiptThumbnail,receipt_original_hash:uploads.find(entry=>entry.slot==='receipt:original')?.sha256??null,
        receipt_processed_hash:uploads.find(entry=>entry.slot==='receipt:processed')?.sha256??null,
        receipt_thumbnail_hash:uploads.find(entry=>entry.slot==='receipt:thumbnail')?.sha256??null,
        receipt_scan_mode:receiptScan?.scanMode??null,receipt_scan_quality:(receiptScan?.quality??null) as Json,
        receipt_quality_policy:(receiptScan?.qualityPolicy??null) as Json,
        receipt_crop:(receiptScan?.crop??null) as Json,receipt_corners:(receiptScan?.corners??null) as Json,
        receipt_rotation:receiptScan?.rotation??0,receipt_quality_confirmed:receiptScan?.qualityConfirmed??false,
        captured_at:receiptScan?.capturedAt??null};
      await persist('dispatch_pending',prepared);
      return prepared;
  }
  async function run() {
    await ensureDurableDraft();
    if (isKnownOffline()) return queuedResult();
    let payload: Record<string, Json>;
    try {
      payload = await prepare();
    } catch (error) {
      if (durableSaved) return queuedResult();
      throw error;
    }
    dispatched = true;
    canRevise = false;
    try {
      const invoke=async()=>outcome
        ? await supabase.rpc('driver_record_delivery_outcome',{_stop_id:stopId,_outcome:outcome,_details:payload,
          _client_event_id:requestId,_expected_status:expectedStatus})
        : await supabase.rpc('driver_record_delivery_note',{_stop_id:stopId,_event_type:eventKey,_details:payload,_client_event_id:requestId});
      const response = await retryAfterSessionRefresh(invoke,value=>value.error);
      if (response.error) {
        if(isAuthorizationFailure(response.error))await markAttention('authorization',response.error);
        else if(isRemoteConflict(response.error))await markAttention('remote_conflict',response.error);
        return queuedResult();
      }
      const fiscalConflict=fiscalConflictSchema.safeParse(response.data);
      if(fiscalConflict.success){
        await markAttention('remote_conflict',Object.assign(new Error('Os documentos desta parada foram realocados. A operação precisa revisar este envio.'),
          {code:fiscalConflict.data.error_code}));
        return queuedResult();
      }
      let result:z.infer<typeof resultSchema> & {queued:false};
      try{result={...resultSchema.parse(response.data),queued:false as const};}
      catch(error){await markAttention('remote_conflict',new Error(`Resposta remota incompatível: ${deliveryErrorMessage(error)}`));return queuedResult();}
      await offlineStore.remove(requestId).catch(() => undefined);
      durableSaved=false;
      durableDraft=null;
      return result;
    } catch (error) {
      if(durableSaved&&isAuthorizationFailure(error))await markAttention('authorization',error);
      else if(durableSaved&&isRemoteConflict(error))await markAttention('remote_conflict',error);
      if (durableSaved) return queuedResult();
      throw error;
    }
  }
  return {
    get dispatched() { return dispatched; },
    get canRevise() { return canRevise; },
    submit() {
      if (!inFlight) inFlight = run().finally(() => { inFlight=null; });
      return inFlight;
    },
  };
}

export async function invalidateDeliveryQueries(client: QueryClient) {
  // A failed refresh cannot turn an already committed delivery into an error.
  // Use the shared graph keys so the operation and portal receive the same result.
  await Promise.allSettled([invalidateCompositionQueries(client), ...['driver_delivery_stops','driver_stops','driver_stop_products','driver_active_trip','driver_trip',
    'driver_trip_specific','driver_loads','driver_events','driver_event_detail','loads','dispatch_trips',
    'fiscal_documents','load_items','operational_events','pod-history','product-history','load-control','load-documents','load-unloading']
    .map(key => client.invalidateQueries({queryKey:[key]}))]);
}
