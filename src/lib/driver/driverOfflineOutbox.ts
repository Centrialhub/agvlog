import type { Json } from '@/integrations/supabase/types';

export const DRIVER_OFFLINE_OUTBOX_CHANGED = 'agvlog:driver-offline-outbox-changed';

const DATABASE_NAME = 'agvlog-driver-offline-v2';
const DATABASE_VERSION = 2;
const STORE_NAME = 'outbox';
const SNAPSHOT_STORE_NAME = 'snapshots';
const SCOPE_INDEX = 'tenant-actor';

export type DriverOfflineKind =
  | 'delivery'
  | 'expense'
  | 'arrival'
  | 'departure'
  | 'journey'
  | 'checklist'
  | 'occurrence'
  | 'cargo';

export type DriverOfflineState = 'queued' | 'syncing' | 'needs_attention';

export interface DriverOfflineFile {
  slot: string;
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
  sha256?: string;
}

export interface DriverOfflineEnvelope<TPayload extends Json = Json> {
  version: 1;
  id: string;
  scopeKey: string;
  tenantId: string;
  actorId: string;
  kind: DriverOfflineKind;
  aggregateId: string;
  state: DriverOfflineState;
  payload: TPayload;
  files: DriverOfflineFile[];
  attempts: number;
  /** Aggregate retryable upload failures for this command. No error text or file metadata is exported. */
  uploadFailures?: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DriverOfflineOutbox {
  put<TPayload extends Json>(record: DriverOfflineEnvelope<TPayload>): Promise<void>;
  list<TPayload extends Json = Json>(
    tenantId: string,
    actorId: string,
    kind?: DriverOfflineKind,
  ): Promise<DriverOfflineEnvelope<TPayload>[]>;
  remove(id: string): Promise<void>;
  update<TPayload extends Json>(
    id: string,
    mutate: (record: DriverOfflineEnvelope<TPayload>) => DriverOfflineEnvelope<TPayload>,
  ): Promise<DriverOfflineEnvelope<TPayload>>;
}

export interface DriverOfflineSnapshotEnvelope<TPayload extends Json = Json> {
  version: 1;
  id: string;
  scopeKey: string;
  tenantId: string;
  actorId: string;
  tripId: string;
  payload: TPayload;
  cachedAt: string;
  expiresAt: string;
}

export interface DriverOfflineSnapshotStore {
  put<TPayload extends Json>(record: DriverOfflineSnapshotEnvelope<TPayload>): Promise<void>;
  read<TPayload extends Json = Json>(id: string): Promise<DriverOfflineSnapshotEnvelope<TPayload> | null>;
  remove(id: string): Promise<void>;
  clearExpired(scopeKey: string, now?: Date): Promise<number>;
  clearScope(scopeKey: string):Promise<number>;
  clearActor(actorId: string):Promise<number>;
  listScope<TPayload extends Json = Json>(scopeKey: string):Promise<DriverOfflineSnapshotEnvelope<TPayload>[]>;
}

export function driverOfflineScope(tenantId: string, actorId: string): string {
  return `${tenantId}:${actorId}`;
}

function unavailable(message: string): Error {
  return new Error(`${message} Nenhum comando será considerado salvo até a confirmação local.`);
}

function notifyChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DRIVER_OFFLINE_OUTBOX_CHANGED));
  }
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function isFile(value: unknown): value is DriverOfflineFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DriverOfflineFile>;
  return typeof candidate.slot === 'string'
    && candidate.slot.length > 0
    && candidate.blob instanceof Blob
    && typeof candidate.name === 'string'
    && typeof candidate.type === 'string'
    && typeof candidate.lastModified === 'number'
    && (candidate.sha256 === undefined || /^[a-f0-9]{64}$/.test(candidate.sha256));
}

const kinds = new Set<DriverOfflineKind>([
  'delivery', 'expense', 'arrival', 'departure', 'journey', 'checklist', 'occurrence', 'cargo',
]);
const states = new Set<DriverOfflineState>(['queued', 'syncing', 'needs_attention']);

function isEnvelope(
  value: unknown,
  tenantId?: string,
  actorId?: string,
): value is DriverOfflineEnvelope {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<DriverOfflineEnvelope>;
  return record.version === 1
    && typeof record.id === 'string'
    && record.id.length > 0
    && typeof record.tenantId === 'string'
    && typeof record.actorId === 'string'
    && record.scopeKey === driverOfflineScope(record.tenantId, record.actorId)
    && (tenantId === undefined || record.tenantId === tenantId)
    && (actorId === undefined || record.actorId === actorId)
    && typeof record.kind === 'string'
    && kinds.has(record.kind as DriverOfflineKind)
    && typeof record.aggregateId === 'string'
    && record.aggregateId.length > 0
    && typeof record.state === 'string'
    && states.has(record.state as DriverOfflineState)
    && record.payload !== undefined
    && Array.isArray(record.files)
    && record.files.every(isFile)
    && Number.isInteger(record.attempts)
    && (record.attempts ?? -1) >= 0
    && (record.uploadFailures === undefined
      || (Number.isInteger(record.uploadFailures) && record.uploadFailures >= 0))
    && (record.lastError === null || typeof record.lastError === 'string')
    && isIsoDate(record.createdAt)
    && isIsoDate(record.updatedAt);
}

function isSnapshot(value:unknown):value is DriverOfflineSnapshotEnvelope {
  if(!value||typeof value!=='object')return false;
  const record=value as Partial<DriverOfflineSnapshotEnvelope>;
  return record.version===1&&typeof record.id==='string'&&record.id.length>0
    &&typeof record.tenantId==='string'&&typeof record.actorId==='string'
    &&record.scopeKey===driverOfflineScope(record.tenantId,record.actorId)
    &&typeof record.tripId==='string'&&record.tripId.length>0&&record.payload!==undefined
    &&isIsoDate(record.cachedAt)&&isIsoDate(record.expiresAt);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(unavailable('O armazenamento offline deste aparelho está indisponível.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      if (!store.indexNames.contains(SCOPE_INDEX)) {
        store.createIndex(SCOPE_INDEX, 'scopeKey', { unique: false });
      }
      const snapshots=database.objectStoreNames.contains(SNAPSHOT_STORE_NAME)
        ?request.transaction!.objectStore(SNAPSHOT_STORE_NAME)
        :database.createObjectStore(SNAPSHOT_STORE_NAME,{keyPath:'id'});
      if(!snapshots.indexNames.contains(SCOPE_INDEX))snapshots.createIndex(SCOPE_INDEX,'scopeKey',{unique:false});
    };
    request.onerror = () => reject(unavailable('Não foi possível abrir a fila offline.'));
    request.onblocked = () => reject(unavailable('Feche outras abas para atualizar a fila offline.'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function requestTransaction<T>(
  mode: IDBTransactionMode,
  makeRequest: (store: IDBObjectStore) => IDBRequest<T>,
  errorMessage: string,
  storeName = STORE_NAME,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    let request: IDBRequest<T>;
    try {
      request = makeRequest(transaction.objectStore(storeName));
    } catch {
      database.close();
      reject(unavailable(errorMessage));
      return;
    }
    transaction.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
    transaction.onabort = () => {
      database.close();
      reject(unavailable(errorMessage));
    };
  });
}

async function updateRecord<TPayload extends Json>(
  id: string,
  mutate: (record: DriverOfflineEnvelope<TPayload>) => DriverOfflineEnvelope<TPayload>,
): Promise<DriverOfflineEnvelope<TPayload>> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(id);
    let updated: DriverOfflineEnvelope<TPayload> | null = null;
    getRequest.onsuccess = () => {
      if (!isEnvelope(getRequest.result)) {
        transaction.abort();
        return;
      }
      try {
        updated = mutate(getRequest.result as DriverOfflineEnvelope<TPayload>);
        if (!isEnvelope(updated)) throw new Error('invalid envelope');
        store.put(updated);
      } catch {
        transaction.abort();
      }
    };
    transaction.oncomplete = () => {
      database.close();
      if (!updated) reject(unavailable('O comando offline não foi encontrado.'));
      else {
        notifyChanged();
        resolve(updated);
      }
    };
    transaction.onabort = () => {
      database.close();
      reject(unavailable('Não foi possível atualizar o comando offline.'));
    };
  });
}

export const driverOfflineOutbox: DriverOfflineOutbox = {
  async put(record) {
    if (!isEnvelope(record, record.tenantId, record.actorId)) {
      throw unavailable('O comando offline é inválido.');
    }
    await requestTransaction('readwrite', store => store.put(record), 'Não foi possível salvar o comando offline.');
    notifyChanged();
  },
  async list<TPayload extends Json = Json>(tenantId: string, actorId: string, kind?: DriverOfflineKind) {
    const rows = await requestTransaction(
      'readonly',
      store => store.index(SCOPE_INDEX).getAll(driverOfflineScope(tenantId, actorId)),
      'Não foi possível consultar a fila offline.',
    );
    if (!Array.isArray(rows) || !rows.every(row => isEnvelope(row, tenantId, actorId))) {
      throw unavailable('A fila offline contém dados incompatíveis com esta sessão.');
    }
    return rows
      .filter(row => kind === undefined || row.kind === kind)
      .sort((first, second) => first.createdAt.localeCompare(second.createdAt)) as DriverOfflineEnvelope<TPayload>[];
  },
  async remove(id) {
    await requestTransaction('readwrite', store => store.delete(id), 'Não foi possível remover o comando confirmado.');
    notifyChanged();
  },
  update: updateRecord,
};

export const driverOfflineSnapshotStore:DriverOfflineSnapshotStore={
  async put(record){
    if(!isSnapshot(record))throw unavailable('O snapshot offline é inválido.');
    await requestTransaction('readwrite',store=>store.put(record),'Não foi possível salvar os dados da viagem.',SNAPSHOT_STORE_NAME);
  },
  async read<TPayload extends Json = Json>(id:string){
    const value=await requestTransaction('readonly',store=>store.get(id),'Não foi possível ler os dados da viagem.',SNAPSHOT_STORE_NAME);
    if(value===undefined)return null;
    if(!isSnapshot(value))throw unavailable('O snapshot offline é incompatível com esta versão.');
    return value as DriverOfflineSnapshotEnvelope<TPayload>;
  },
  async remove(id){
    await requestTransaction('readwrite',store=>store.delete(id),'Não foi possível remover os dados antigos da viagem.',SNAPSHOT_STORE_NAME);
  },
  async clearExpired(scopeKey,now=new Date()){
    const rows=await requestTransaction('readonly',store=>store.index(SCOPE_INDEX).getAll(scopeKey),
      'Não foi possível verificar os dados antigos da viagem.',SNAPSHOT_STORE_NAME);
    const expired=(rows as unknown[]).filter(isSnapshot).filter(row=>new Date(row.expiresAt)<=now);
    for(const row of expired)await requestTransaction('readwrite',store=>store.delete(row.id),
      'Não foi possível remover os dados antigos da viagem.',SNAPSHOT_STORE_NAME);
    return expired.length;
  },
  async clearScope(scopeKey){
    const rows=await requestTransaction('readonly',store=>store.index(SCOPE_INDEX).getAll(scopeKey),
      'Não foi possível localizar os dados da sessão.',SNAPSHOT_STORE_NAME);
    const scoped=(rows as unknown[]).filter(isSnapshot);
    for(const row of scoped)await requestTransaction('readwrite',store=>store.delete(row.id),
      'Não foi possível limpar os dados da sessão.',SNAPSHOT_STORE_NAME);
    return scoped.length;
  },
  async listScope<TPayload extends Json = Json>(scopeKey:string){
    const rows=await requestTransaction('readonly',store=>store.index(SCOPE_INDEX).getAll(scopeKey),
      'Não foi possível localizar os dados da sessão.',SNAPSHOT_STORE_NAME);
    if(!Array.isArray(rows)||!rows.every(isSnapshot))throw unavailable('Os dados offline contêm registros incompatíveis.');
    return rows.filter(row=>row.scopeKey===scopeKey) as DriverOfflineSnapshotEnvelope<TPayload>[];
  },
  async clearActor(actorId:string){
    const rows=await requestTransaction('readonly',store=>store.getAll(),
      'Não foi possível localizar os dados do usuário.',SNAPSHOT_STORE_NAME);
    const actorRows=(rows as unknown[]).filter(isSnapshot).filter(row=>row.actorId===actorId);
    for(const row of actorRows)await requestTransaction('readwrite',store=>store.delete(row.id),
      'Não foi possível limpar os dados do usuário.',SNAPSHOT_STORE_NAME);
    return actorRows.length;
  },
};

export async function clearDriverOfflineSnapshots(tenantId:string|undefined,actorId:string|undefined):Promise<number>{
  if(!actorId)return 0;
  if(!tenantId)return driverOfflineSnapshotStore.clearActor(actorId);
  return driverOfflineSnapshotStore.clearScope(driverOfflineScope(tenantId,actorId));
}

export function createMemoryDriverOfflineOutbox(): DriverOfflineOutbox {
  const records = new Map<string, DriverOfflineEnvelope>();
  return {
    async put(record) {
      if (!isEnvelope(record, record.tenantId, record.actorId)) throw unavailable('O comando offline é inválido.');
      records.set(record.id, structuredClone(record));
    },
    async list<TPayload extends Json = Json>(tenantId: string, actorId: string, kind?: DriverOfflineKind) {
      return [...records.values()]
        .filter(record => record.tenantId === tenantId && record.actorId === actorId && (!kind || record.kind === kind))
        .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
        .map(record => structuredClone(record)) as DriverOfflineEnvelope<TPayload>[];
    },
    async remove(id) {
      records.delete(id);
    },
    async update(id, mutate) {
      const current = records.get(id);
      if (!current) throw unavailable('O comando offline não foi encontrado.');
      const updated = mutate(structuredClone(current) as never);
      if (!isEnvelope(updated)) throw unavailable('O comando offline é inválido.');
      records.set(id, structuredClone(updated));
      return structuredClone(updated) as never;
    },
  };
}
