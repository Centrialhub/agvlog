import { z } from 'zod';

import type { Json } from '@/integrations/supabase/types';
import type {
  DriverOfflineEnvelope,
  DriverOfflineOutbox,
  DriverOfflineState,
} from '@/lib/driver/driverOfflineOutbox';
import { driverOfflineScope, driverOfflineSnapshotStore } from '@/lib/driver/driverOfflineOutbox';
import type { JourneyEventType } from '@/lib/driverJourney';
import type { TripCargoSnapshot } from '@/lib/driver/tripCargoCustody';
import type { DriverOperationalEventItem } from '@/lib/driver/driverOperationalEventHistory';
import type { DriverDeliveryFiscalSnapshot } from '@/lib/driver/driverDeliveryFiscalSnapshot';

const uuid = z.string().uuid();
const operationalKinds = ['arrival', 'departure', 'journey', 'checklist', 'occurrence'] as const;
export type DriverOperationalOfflineKind = typeof operationalKinds[number];

export type DriverArrivalCommand = {
  trip_id: string; stop_id: string; latitude: number; longitude: number; accuracy_m: number;
};
export type DriverDepartureCommand = { trip_id: string; stop_id: string; notes: string | null };
export type DriverJourneyCommand = {
  trip_id: string;
  event_type: JourneyEventType;
  event_payload: {
    source: 'driver_app';
    expected_previous_event_id: string | null;
    expected_previous_request_id?: string | null;
  };
};
export type DriverChecklistCommand = {
  trip_id: string;
  kind: 'pre' | 'post';
  checklist_payload: {
    checked_items: number[];
    total_items: number;
    expected_checklist_id: string | null;
    expected_boundary_id: string | null;
    expected_boundary_request_id?: string | null;
  };
};
export type DriverOccurrenceCommand = {
  trip_id: string;
  event_type: string;
  description: string;
  severity: string;
  stop_id: string | null;
  client_id: string | null;
};
export type DriverOperationalCommand =
  | { kind: 'arrival'; aggregateId: string; payload: DriverArrivalCommand }
  | { kind: 'departure'; aggregateId: string; payload: DriverDepartureCommand }
  | { kind: 'journey'; aggregateId: string; payload: DriverJourneyCommand }
  | { kind: 'checklist'; aggregateId: string; payload: DriverChecklistCommand }
  | { kind: 'occurrence'; aggregateId: string; payload: DriverOccurrenceCommand };

const receiptSchema = z.object({
  version: z.literal(1), confirmed: z.literal(true), replayed: z.boolean(),
  tenant_id: uuid, actor_id: uuid, request_id: uuid,
  command: z.enum(['arrival', 'departure', 'journey_event', 'checklist', 'occurrence']),
  trip_id: uuid, entity_id: uuid,
}).strict();
export type DriverOperationalReceipt = z.infer<typeof receiptSchema>;

export type DriverOperationalSubmitResult = {
  id: string;
  state: DriverOfflineState | 'confirmed';
  queued: boolean;
  receipt: DriverOperationalReceipt | null;
  error: string | null;
};

type OperationalEnvelope = DriverOfflineEnvelope<Json> & { kind: DriverOperationalOfflineKind };
type RemoteError = Error & { code?: string; retryable?: boolean };

export interface DriverOperationalCommandDependencies {
  outbox: DriverOfflineOutbox;
  send(record: OperationalEnvelope): Promise<unknown>;
  uuid(): string;
  now(): Date;
  isOnline(): boolean;
}

const remoteCommand = (kind: DriverOperationalOfflineKind) => kind === 'journey' ? 'journey_event' : kind;

function isOperationalEnvelope(record: DriverOfflineEnvelope): record is OperationalEnvelope {
  return operationalKinds.includes(record.kind as DriverOperationalOfflineKind);
}

function retryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true;
  const candidate = error as RemoteError;
  if (candidate.retryable !== undefined) return candidate.retryable;
  if (!candidate.code) return true;
  return ['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'].includes(candidate.code)
    || candidate.code.startsWith('5');
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Não foi possível sincronizar o comando.';
}

function validateReceipt(record: OperationalEnvelope, value: unknown): DriverOperationalReceipt {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success || parsed.data.tenant_id !== record.tenantId
    || parsed.data.actor_id !== record.actorId || parsed.data.request_id !== record.id
    || parsed.data.trip_id !== record.aggregateId || parsed.data.command !== remoteCommand(record.kind)) {
    const error = new Error('O servidor retornou uma confirmação incompatível com o comando offline.') as RemoteError;
    error.retryable = false;
    throw error;
  }
  return parsed.data;
}

export function createDriverOperationalCommandService(deps: DriverOperationalCommandDependencies) {
  const syncOne = async (record: OperationalEnvelope): Promise<DriverOperationalSubmitResult> => {
    await deps.outbox.update<Json>(record.id, current => ({
      ...current, state: 'syncing', attempts: current.attempts + 1,
      lastError: null, updatedAt: deps.now().toISOString(),
    }));
    try {
      const receipt = validateReceipt(record, await deps.send(record));
      await deps.outbox.remove(record.id);
      return { id: record.id, state: 'confirmed', queued: false, receipt, error: null };
    } catch (error) {
      const state: DriverOfflineState = retryable(error) ? 'queued' : 'needs_attention';
      const message = errorMessage(error);
      await deps.outbox.update<Json>(record.id, current => ({
        ...current, state, lastError: message, updatedAt: deps.now().toISOString(),
      }));
      return { id: record.id, state, queued: true, receipt: null, error: message };
    }
  };

  const submit = async (
    tenantId: string,
    actorId: string,
    command: DriverOperationalCommand,
  ): Promise<DriverOperationalSubmitResult> => {
    const id = deps.uuid();
    const createdAt = deps.now().toISOString();
    const record: OperationalEnvelope = {
      version: 1, id, scopeKey: driverOfflineScope(tenantId, actorId), tenantId, actorId,
      kind: command.kind, aggregateId: command.aggregateId, state: 'queued',
      payload: command.payload as Json, files: [], attempts: 0, lastError: null,
      createdAt, updatedAt: createdAt,
    };
    await deps.outbox.put(record);
    if (!deps.isOnline()) {
      return { id, state: 'queued', queued: true, receipt: null, error: null };
    }
    return syncOne(record);
  };

  const recover = async (tenantId: string, actorId: string, includeNeedsAttention = false) => {
    if (!deps.isOnline()) return { confirmed: 0, pending: (await deps.outbox.list(tenantId, actorId)).length };
    const records = (await deps.outbox.list(tenantId, actorId))
      .filter(isOperationalEnvelope)
      .filter(record => includeNeedsAttention || record.state !== 'needs_attention');
    let confirmed = 0;
    for (const record of records) {
      const result = await syncOne(record);
      if (result.state === 'confirmed') confirmed += 1;
      if (result.state === 'queued') break;
    }
    return { confirmed, pending: (await deps.outbox.list(tenantId, actorId)).filter(isOperationalEnvelope).length };
  };

  return { submit, recover };
}

export interface DriverOperationalSnapshot {
  version: 1;
  tenantId: string;
  actorId: string;
  tripId: string;
  cachedAt: string;
  trip: {
    id: string; status: string; actualStartAt: string | null; actualEndAt: string | null;
    driver: { id: string; name: string };
    vehicle: { id: string; plate: string; nickname: string | null } | null;
  };
  loads: Array<{
    id: string; loadNumber: string; status: string; origin: string | null; destination: string | null;
    volumeCount: number | null; palletCount: number | null; weightKg: number | null;
  }>;
  stops: Array<{
    id: string; order: number | null; status: string; destination: string | null;
    latitude: number | null; longitude: number | null; notes: string | null;
    client: { id: string | null; name: string } | null;
    actualArrivalAt: string | null; actualDepartureAt: string | null;
  }>;
  documents: Array<{
    id: string; loadId: string | null; kind: 'nfe' | 'nfse' | 'cte' | 'operational_reference'; referenceNumber: string;
  }>;
  /** Allocation-specific delivery items, cached per stop for an authenticated offline reopen. */
  deliveryItemsByStop?: Record<string, Array<{
    id: string; fiscalDocumentId: string; attemptId: string | null; isHistorical: boolean;
    sku: string; name: string; qty: number; unit: string; price: number; documentStatus: string;
  }>>;
  /** Exact fiscal allocation precondition captured while online, keyed by stop. */
  deliveryFiscalSnapshotsByStop?: Record<string, DriverDeliveryFiscalSnapshot>;
  instructions: string[];
  checklist: {
    pre: { id: string | null; boundaryId: string | null; checkedItems: number[] };
    post: { id: string | null; boundaryId: string | null; checkedItems: number[] };
  };
  journey: {
    events: Array<{ id: string; tripId: string; type: JourneyEventType; eventAt: string }>;
    lastStartId: string | null; lastEndId: string | null;
  };
  /** Recent occurrences for this trip, used only after the same tenant and actor reopen offline. */
  occurrences?: DriverOperationalEventItem[];
  cargo: TripCargoSnapshot | null;
}

export interface DriverOperationalSnapshotStore {
  put(snapshot: DriverOperationalSnapshot): Promise<void>;
  read(tenantId: string, actorId: string, tripId: string): Promise<DriverOperationalSnapshot | null>;
  remove(tenantId: string, actorId: string, tripId: string): Promise<void>;
  readLatest(tenantId: string, actorId: string): Promise<DriverOperationalSnapshot | null>;
}

const snapshotKey = (tenantId: string, actorId: string, tripId: string) => `${tenantId}:${actorId}:${tripId}`;

export function isDriverOperationalSnapshot(value: unknown, tenantId?: string, actorId?: string, tripId?: string): value is DriverOperationalSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<DriverOperationalSnapshot>;
  return snapshot.version === 1 && typeof snapshot.tenantId === 'string' && typeof snapshot.actorId === 'string'
    && typeof snapshot.tripId === 'string' && snapshot.trip?.id === snapshot.tripId
    && (tenantId === undefined || snapshot.tenantId === tenantId)
    && (actorId === undefined || snapshot.actorId === actorId)
    && (tripId === undefined || snapshot.tripId === tripId)
    && typeof snapshot.cachedAt === 'string' && Number.isFinite(Date.parse(snapshot.cachedAt))
    && typeof snapshot.trip.status === 'string' && typeof snapshot.trip.driver?.id === 'string'
    && typeof snapshot.trip.driver.name === 'string' && Array.isArray(snapshot.loads) && Array.isArray(snapshot.stops)
    && Array.isArray(snapshot.documents) && Array.isArray(snapshot.instructions)
    && (snapshot.deliveryItemsByStop === undefined || isDeliveryItemsByStop(snapshot.deliveryItemsByStop))
    && (snapshot.deliveryFiscalSnapshotsByStop === undefined
      || isDeliveryFiscalSnapshotsByStop(snapshot.deliveryFiscalSnapshotsByStop, snapshot))
    && !!snapshot.checklist && Array.isArray(snapshot.checklist.pre?.checkedItems)
    && Array.isArray(snapshot.checklist.post?.checkedItems) && !!snapshot.journey
    && Array.isArray(snapshot.journey.events)
    && (snapshot.occurrences === undefined || isSnapshotOccurrenceHistory(snapshot));
}

function isDeliveryFiscalSnapshotsByStop(value: unknown, snapshot: Partial<DriverOperationalSnapshot>): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([stopId, candidate]) => !!candidate && typeof candidate === 'object'
    && !Array.isArray(candidate) && (candidate as DriverDeliveryFiscalSnapshot).version === 1
    && (candidate as DriverDeliveryFiscalSnapshot).tenant_id === snapshot.tenantId
    && (candidate as DriverDeliveryFiscalSnapshot).actor_id === snapshot.actorId
    && (candidate as DriverDeliveryFiscalSnapshot).trip_id === snapshot.tripId
    && (candidate as DriverDeliveryFiscalSnapshot).stop_id === stopId
    && typeof (candidate as DriverDeliveryFiscalSnapshot).revision === 'string'
    && /^[0-9a-f]{32}$/.test((candidate as DriverDeliveryFiscalSnapshot).revision)
    && Array.isArray((candidate as DriverDeliveryFiscalSnapshot).documents));
}

function isSnapshotOccurrenceHistory(snapshot: Partial<DriverOperationalSnapshot>): boolean {
  return Array.isArray(snapshot.occurrences) && snapshot.occurrences.length <= 50
    && snapshot.occurrences.every(item => !!item && typeof item === 'object'
      && typeof item.id === 'string' && typeof item.event_type === 'string'
      && typeof item.severity === 'string' && typeof item.created_at === 'string'
      && Number.isFinite(Date.parse(item.created_at))
      && item.tenant_id === snapshot.tenantId
      && item.driver_id === snapshot.trip?.driver.id
      && item.dispatch_trip_id === snapshot.tripId);
}

function isDeliveryItemsByStop(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([stopId, items]) => !!stopId && Array.isArray(items) && items.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    return typeof row.id === 'string' && !!row.id && typeof row.fiscalDocumentId === 'string' && !!row.fiscalDocumentId
      && (row.attemptId === null || typeof row.attemptId === 'string') && typeof row.isHistorical === 'boolean'
      && typeof row.sku === 'string' && typeof row.name === 'string' && typeof row.qty === 'number'
      && Number.isFinite(row.qty) && row.qty > 0 && typeof row.unit === 'string' && typeof row.price === 'number'
      && Number.isFinite(row.price) && typeof row.documentStatus === 'string';
  }));
}

export function createMemoryDriverOperationalSnapshotStore(): DriverOperationalSnapshotStore {
  const records = new Map<string, DriverOperationalSnapshot>();
  return {
    async put(snapshot) {
      if (!isDriverOperationalSnapshot(snapshot)) throw new Error('O snapshot operacional é inválido.');
      records.set(snapshotKey(snapshot.tenantId, snapshot.actorId, snapshot.tripId), structuredClone(snapshot));
    },
    async read(tenantId, actorId, tripId) {
      const value = records.get(snapshotKey(tenantId, actorId, tripId));
      return value ? structuredClone(value) : null;
    },
    async remove(tenantId, actorId, tripId) {
      records.delete(snapshotKey(tenantId, actorId, tripId));
    },
    async readLatest(tenantId, actorId) {
      return [...records.values()].filter(snapshot=>snapshot.tenantId===tenantId&&snapshot.actorId===actorId)
        .sort((a,b)=>b.cachedAt.localeCompare(a.cachedAt)).map(snapshot=>structuredClone(snapshot))[0]??null;
    },
  };
}

const SNAPSHOT_MAX_AGE_MS=7*24*60*60*1000;

export const driverOperationalSnapshotStore:DriverOperationalSnapshotStore={
  async put(snapshot){
    const cachedAt=new Date(snapshot.cachedAt);
    if(!isDriverOperationalSnapshot(snapshot)||!Number.isFinite(cachedAt.getTime()))throw new Error('O snapshot operacional é inválido.');
    await driverOfflineSnapshotStore.put({version:1,id:snapshotKey(snapshot.tenantId,snapshot.actorId,snapshot.tripId),
      scopeKey:driverOfflineScope(snapshot.tenantId,snapshot.actorId),tenantId:snapshot.tenantId,actorId:snapshot.actorId,
      tripId:snapshot.tripId,payload:snapshot as unknown as Json,cachedAt:snapshot.cachedAt,
      expiresAt:new Date(cachedAt.getTime()+SNAPSHOT_MAX_AGE_MS).toISOString()});
  },
  async read(tenantId,actorId,tripId){
    const id=snapshotKey(tenantId,actorId,tripId),record=await driverOfflineSnapshotStore.read(id);
    if(!record)return null;
    if(record.tenantId!==tenantId||record.actorId!==actorId||record.tripId!==tripId)throw new Error('O snapshot não pertence a esta sessão.');
    if(new Date(record.expiresAt)<=new Date()){await driverOfflineSnapshotStore.remove(id);return null;}
    if(!isDriverOperationalSnapshot(record.payload,tenantId,actorId,tripId)){
      await driverOfflineSnapshotStore.remove(id);throw new Error('O snapshot operacional salvo é incompatível com esta versão.');
    }
    return structuredClone(record.payload);
  },
  async remove(tenantId,actorId,tripId){await driverOfflineSnapshotStore.remove(snapshotKey(tenantId,actorId,tripId));},
  async readLatest(tenantId,actorId){
    const scope=driverOfflineScope(tenantId,actorId);
    await driverOfflineSnapshotStore.clearExpired(scope);
    const rows=await driverOfflineSnapshotStore.listScope(scope);
    for(const row of rows.sort((a,b)=>b.cachedAt.localeCompare(a.cachedAt))){
      if(isDriverOperationalSnapshot(row.payload,tenantId,actorId,row.tripId))return structuredClone(row.payload);
    }
    return null;
  },
};
