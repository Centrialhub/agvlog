import type { Json } from '@/integrations/supabase/types';
import type { ReceiptScanResult } from '@/lib/driver/receiptScan';
import { driverOfflineOutbox, driverOfflineScope, type DriverOfflineEnvelope, type DriverOfflineFile } from '@/lib/driver/driverOfflineOutbox';

const databaseName = 'agvlog-driver-offline-v1';
const storeName = 'delivery-submissions';
const scopeIndex = 'tenant-actor';

export interface StoredDriverFile {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
  sha256?: string;
}

export interface StoredReceiptScan {
  original: StoredDriverFile;
  processed: StoredDriverFile;
  thumbnail?: StoredDriverFile;
  originalHash?: string;
  processedHash?: string;
  thumbnailHash?: string;
  capturedAt: string;
  scanMode: ReceiptScanResult['scanMode'];
  crop: ReceiptScanResult['crop'];
  corners?: ReceiptScanResult['corners'];
  rotation?: ReceiptScanResult['rotation'];
  quality: ReceiptScanResult['quality'];
  qualityPolicy?: ReceiptScanResult['qualityPolicy'];
  qualityConfirmed?: boolean;
}

export type DriverDeliveryUploadState = 'pending' | 'uploaded' | 'needs_attention';

export interface DriverDeliveryUploadLedgerEntry {
  slot: string;
  sha256: string;
  path: string | null;
  state: DriverDeliveryUploadState;
}

export interface DriverDeliveryAttention {
  kind: 'local_evidence_conflict' | 'remote_conflict' | 'authorization' | 'upload_failure';
  code: string | null;
  message: string;
  slot: string | null;
  expectedSha256: string | null;
  actualSha256: string | null;
  path: string | null;
  recordedAt: string;
}

export interface DriverDeliveryOfflineDraft {
  version: 1;
  requestId: string;
  scopeKey: string;
  tenantId: string;
  actorId: string;
  tripId: string;
  stopId: string;
  expectedStatus: string;
  eventKey: string;
  outcome: string | null;
  details: Record<string, Json>;
  photos: StoredDriverFile[];
  receiptScan: StoredReceiptScan | null;
  signature: StoredDriverFile | null;
  state?: 'queued' | 'needs_attention';
  uploadFailures?: number;
  attention?: DriverDeliveryAttention | null;
  synchronization?: {
    stage: 'queued' | 'preparing' | 'dispatch_pending' | 'cleanup_pending' | 'needs_attention';
    uploadedPaths: string[];
    preparedDetails: Record<string, Json> | null;
    uploads?: DriverDeliveryUploadLedgerEntry[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface DriverDeliveryOfflineStore {
  save(draft: DriverDeliveryOfflineDraft): Promise<void>;
  list(tenantId: string, actorId: string): Promise<DriverDeliveryOfflineDraft[]>;
  remove(requestId: string): Promise<void>;
  hasPendingPredecessor?(draft: DriverDeliveryOfflineDraft): Promise<boolean>;
}

export function createMemoryDriverDeliveryOfflineStore(): DriverDeliveryOfflineStore {
  const records=new Map<string,DriverDeliveryOfflineDraft>();
  return {
    async save(draft){records.set(draft.requestId,draft);},
    async list(tenantId,actorId){return [...records.values()].filter(draft=>draft.tenantId===tenantId&&draft.actorId===actorId)
      .sort((first,second)=>first.createdAt.localeCompare(second.createdAt));},
    async remove(requestId){records.delete(requestId);},
  };
}

export function driverDeliveryScope(tenantId: string, actorId: string): string {
  return `${tenantId}:${actorId}`;
}

function storageError(message: string): Error {
  return new Error(`${message} O comprovante não foi liberado; mantenha esta tela aberta e tente novamente.`);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(storageError('O armazenamento offline deste aparelho está indisponível.'));
      return;
    }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(storeName)
        ? request.transaction!.objectStore(storeName)
        : database.createObjectStore(storeName, { keyPath: 'requestId' });
      if (!store.indexNames.contains(scopeIndex)) store.createIndex(scopeIndex, 'scopeKey', { unique: false });
    };
    request.onerror = () => reject(storageError('Não foi possível abrir o armazenamento offline.'));
    request.onblocked = () => reject(storageError('Feche outras abas do aplicativo para atualizar o armazenamento offline.'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
  failureMessage: string,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    let request: IDBRequest<T>;
    try {
      request = work(transaction.objectStore(storeName));
    } catch {
      database.close();
      reject(storageError(failureMessage));
      return;
    }
    transaction.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
    transaction.onabort = () => {
      database.close();
      reject(storageError(failureMessage));
    };
    transaction.onerror = () => {
      // The abort handler is authoritative: never report a partial write as durable.
    };
  });
}

function isStoredFile(value: unknown): value is StoredDriverFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<StoredDriverFile>;
  return file.blob instanceof Blob
    && typeof file.name === 'string'
    && typeof file.type === 'string'
    && typeof file.lastModified === 'number';
}

function isSynchronization(value:unknown):value is NonNullable<DriverDeliveryOfflineDraft['synchronization']>{
  if(!value||typeof value!=='object')return false;
  const synchronization=value as NonNullable<DriverDeliveryOfflineDraft['synchronization']>;
  return ['queued','preparing','dispatch_pending','cleanup_pending','needs_attention'].includes(synchronization.stage)
    &&Array.isArray(synchronization.uploadedPaths)
    &&synchronization.uploadedPaths.every(path=>typeof path==='string'&&path.length>0)
    &&(synchronization.uploads===undefined||Array.isArray(synchronization.uploads)
      &&synchronization.uploads.every(entry=>!!entry&&typeof entry==='object'
        &&typeof entry.slot==='string'&&entry.slot.length>0
        &&/^[a-f0-9]{64}$/.test(entry.sha256)
        &&(entry.path===null||typeof entry.path==='string'&&entry.path.length>0)
        &&['pending','uploaded','needs_attention'].includes(entry.state)))
    &&(synchronization.preparedDetails===null
      ||(typeof synchronization.preparedDetails==='object'&&!Array.isArray(synchronization.preparedDetails)));
}

function isDraft(value: unknown, tenantId: string, actorId: string): value is DriverDeliveryOfflineDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<DriverDeliveryOfflineDraft>;
  return draft.version === 1
    && draft.tenantId === tenantId
    && draft.actorId === actorId
    && draft.scopeKey === driverDeliveryScope(tenantId, actorId)
    && typeof draft.requestId === 'string'
    && typeof draft.tripId === 'string'
    && typeof draft.stopId === 'string'
    && typeof draft.expectedStatus === 'string'
    && typeof draft.eventKey === 'string'
    && (draft.outcome === null || typeof draft.outcome === 'string')
    && !!draft.details && typeof draft.details === 'object' && !Array.isArray(draft.details)
    && Array.isArray(draft.photos) && draft.photos.every(isStoredFile)
    && (draft.receiptScan === null || (!!draft.receiptScan
      && isStoredFile(draft.receiptScan.original)
      && isStoredFile(draft.receiptScan.processed)))
    && (draft.signature === null || isStoredFile(draft.signature))
    && (draft.state === undefined || ['queued','needs_attention'].includes(draft.state))
    && (draft.uploadFailures === undefined || (Number.isInteger(draft.uploadFailures) && draft.uploadFailures >= 0))
    && (draft.attention === undefined || draft.attention === null || (!!draft.attention
      && ['local_evidence_conflict','remote_conflict','authorization','upload_failure'].includes(draft.attention.kind)
      && (draft.attention.code === null || typeof draft.attention.code === 'string')
      && typeof draft.attention.message === 'string'
      && (draft.attention.slot === null || typeof draft.attention.slot === 'string')
      && (draft.attention.expectedSha256 === null || /^[a-f0-9]{64}$/.test(draft.attention.expectedSha256))
      && (draft.attention.actualSha256 === null || /^[a-f0-9]{64}$/.test(draft.attention.actualSha256))
      && (draft.attention.path === null || typeof draft.attention.path === 'string')
      && typeof draft.attention.recordedAt === 'string'))
    && (draft.synchronization === undefined || isSynchronization(draft.synchronization))
    && typeof draft.createdAt === 'string'
    && typeof draft.updatedAt === 'string';
}

export function storeDriverFile(file: File): StoredDriverFile {
  return { blob: file, name: file.name, type: file.type, lastModified: file.lastModified };
}

export function restoreDriverFile(file: StoredDriverFile): File {
  return new File([file.blob], file.name, { type: file.type, lastModified: file.lastModified });
}

export function restoreReceiptScan(scan: StoredReceiptScan | null): ReceiptScanResult | null {
  if (!scan) return null;
  return {
    original: restoreDriverFile(scan.original),
    processed: restoreDriverFile(scan.processed),
    thumbnail: scan.thumbnail ? restoreDriverFile(scan.thumbnail) : undefined,
    originalHash:scan.originalHash,processedHash:scan.processedHash,thumbnailHash:scan.thumbnailHash,
    capturedAt: scan.capturedAt,
    scanMode: scan.scanMode,
    crop: structuredClone(scan.crop),
    corners:scan.corners?structuredClone(scan.corners):undefined,rotation:scan.rotation,
    quality: structuredClone(scan.quality),
    qualityPolicy:scan.qualityPolicy?structuredClone(scan.qualityPolicy):undefined,
    qualityConfirmed:scan.qualityConfirmed,
  };
}

const legacyDriverDeliveryOfflineStore: DriverDeliveryOfflineStore = {
  async save(draft) {
    if (!isDraft(draft, draft.tenantId, draft.actorId)) throw storageError('Os dados da entrega offline são inválidos.');
    await transact('readwrite', store => store.put(draft), 'Não foi possível salvar o comprovante no aparelho.');
  },
  async list(tenantId, actorId) {
    const values = await transact(
      'readonly',
      store => store.index(scopeIndex).getAll(driverDeliveryScope(tenantId, actorId)),
      'Não foi possível consultar os envios pendentes.',
    );
    if (!Array.isArray(values) || !values.every(value => isDraft(value, tenantId, actorId))) {
      throw storageError('Há um envio offline incompatível com esta sessão.');
    }
    return values.sort((first, second) => first.createdAt.localeCompare(second.createdAt));
  },
  async remove(requestId) {
    await transact('readwrite', store => store.delete(requestId), 'Não foi possível concluir a limpeza do envio sincronizado.');
  },
};

interface DeliveryEnvelopePayload {
  version:1;stopId:string;expectedStatus:string;eventKey:string;outcome:string|null;details:Record<string,Json>;
  receiptScan:Omit<StoredReceiptScan,'original'|'processed'|'thumbnail'>|null;
  photoCount:number;hasSignature:boolean;
  synchronization?:DriverDeliveryOfflineDraft['synchronization'];
  attention?:DriverDeliveryAttention|null;
}

const asOfflineFile=(slot:string,file:StoredDriverFile,sha256?:string):DriverOfflineFile=>({slot,blob:file.blob,name:file.name,
  type:file.type,lastModified:file.lastModified,sha256:sha256??file.sha256});
const asStoredFile=(file:DriverOfflineFile):StoredDriverFile=>({blob:file.blob,name:file.name,type:file.type,lastModified:file.lastModified,sha256:file.sha256});

function toEnvelope(draft:DriverDeliveryOfflineDraft):DriverOfflineEnvelope<Json>{
  const files:DriverOfflineFile[]=draft.photos.map((file,index)=>asOfflineFile(`photo:${index}`,file));
  if(draft.receiptScan){files.push(asOfflineFile('receipt:original',draft.receiptScan.original,draft.receiptScan.originalHash));
    files.push(asOfflineFile('receipt:processed',draft.receiptScan.processed,draft.receiptScan.processedHash));
    if(draft.receiptScan.thumbnail)files.push(asOfflineFile('receipt:thumbnail',draft.receiptScan.thumbnail,draft.receiptScan.thumbnailHash));}
  if(draft.signature)files.push(asOfflineFile('signature',draft.signature));
  const scan=draft.receiptScan?{capturedAt:draft.receiptScan.capturedAt,scanMode:draft.receiptScan.scanMode,crop:draft.receiptScan.crop,
    corners:draft.receiptScan.corners,rotation:draft.receiptScan.rotation,quality:draft.receiptScan.quality,
    qualityPolicy:draft.receiptScan.qualityPolicy,qualityConfirmed:draft.receiptScan.qualityConfirmed,
    originalHash:draft.receiptScan.originalHash,processedHash:draft.receiptScan.processedHash,thumbnailHash:draft.receiptScan.thumbnailHash}:null;
  const payload:DeliveryEnvelopePayload={version:1,stopId:draft.stopId,expectedStatus:draft.expectedStatus,eventKey:draft.eventKey,outcome:draft.outcome,
    details:draft.details,receiptScan:scan,photoCount:draft.photos.length,hasSignature:!!draft.signature,
    synchronization:draft.synchronization,attention:draft.attention??null};
  return {version:1,id:draft.requestId,scopeKey:driverOfflineScope(draft.tenantId,draft.actorId),tenantId:draft.tenantId,actorId:draft.actorId,
    kind:'delivery',aggregateId:draft.tripId,state:draft.state??(draft.synchronization?.stage==='needs_attention'?'needs_attention':'queued'),
    payload:payload as unknown as Json,files,attempts:0,uploadFailures:draft.uploadFailures??0,lastError:draft.attention?.message??null,
    createdAt:draft.createdAt,updatedAt:draft.updatedAt};
}

function fromEnvelope(record:DriverOfflineEnvelope):DriverDeliveryOfflineDraft {
  const payload=record.payload as unknown as DeliveryEnvelopePayload;
  if(payload.version!==1||typeof payload.photoCount!=='number')throw storageError('A entrega na fila unificada é incompatível.');
  const find=(slot:string)=>record.files.find(file=>file.slot===slot);
  const original=find('receipt:original'),processed=find('receipt:processed'),thumbnail=find('receipt:thumbnail'),signature=find('signature');
  const receiptScan=payload.receiptScan?{
    ...payload.receiptScan,
    original:original?asStoredFile(original):null,
    processed:processed?asStoredFile(processed):null,
    thumbnail:thumbnail?asStoredFile(thumbnail):undefined,
  }:null;
  if(receiptScan&&(!receiptScan.original||!receiptScan.processed))throw storageError('Os arquivos do canhoto estão incompletos.');
  const draft:DriverDeliveryOfflineDraft={version:1,requestId:record.id,scopeKey:driverDeliveryScope(record.tenantId,record.actorId),
    tenantId:record.tenantId,actorId:record.actorId,tripId:record.aggregateId,stopId:payload.stopId,
    expectedStatus:payload.expectedStatus,eventKey:payload.eventKey,outcome:payload.outcome,details:payload.details,
    photos:Array.from({length:payload.photoCount},(_,index)=>find(`photo:${index}`)).filter((file):file is DriverOfflineFile=>!!file).map(asStoredFile),
    receiptScan:receiptScan as StoredReceiptScan|null,signature:signature?asStoredFile(signature):null,
    state:record.state==='needs_attention'?'needs_attention':'queued',uploadFailures:record.uploadFailures??0,attention:payload.attention??null,
    synchronization:payload.synchronization,createdAt:record.createdAt,updatedAt:record.updatedAt};
  return draft;
}

export const driverDeliveryOfflineStore:DriverDeliveryOfflineStore={
  async save(draft){
    if(!isDraft(draft,draft.tenantId,draft.actorId))throw storageError('Os dados da entrega offline são inválidos.');
    await driverOfflineOutbox.put(toEnvelope(draft));
  },
  async list(tenantId,actorId){
    const unified=(await driverOfflineOutbox.list(tenantId,actorId,'delivery')).map(fromEnvelope);
    let legacy:DriverDeliveryOfflineDraft[]=[];
    try{legacy=await legacyDriverDeliveryOfflineStore.list(tenantId,actorId);}catch{/* legacy storage is best-effort during upgrade */}
    const ids=new Set(unified.map(item=>item.requestId));
    for(const draft of legacy){if(ids.has(draft.requestId))continue;await driverOfflineOutbox.put(toEnvelope(draft));
      await legacyDriverDeliveryOfflineStore.remove(draft.requestId).catch(()=>undefined);unified.push(draft);}
    return unified.sort((first,second)=>first.createdAt.localeCompare(second.createdAt));
  },
  async remove(requestId){
    await driverOfflineOutbox.remove(requestId);
    await legacyDriverDeliveryOfflineStore.remove(requestId).catch(()=>undefined);
  },
  async hasPendingPredecessor(draft){
    const records=await driverOfflineOutbox.list(draft.tenantId,draft.actorId);
    return records.some(record=>record.kind!=='delivery'&&record.aggregateId===draft.tripId
      && record.createdAt<=draft.createdAt&&record.state!=='needs_attention');
  },
};
