import { z } from 'zod';

import { supabase } from '@/integrations/supabase/client';
import { acknowledgeDurableOperatorCommand, prepareDurableOperatorCommand } from '@/lib/operator/durableOperatorCommand';

const uuid = z.string().uuid();
export const tripCargoStatuses = [
  'pending_acceptance', 'accepted', 'loading', 'ready_to_depart', 'departed', 'returned', 'closed',
] as const;
export type TripCargoStatus = typeof tripCargoStatuses[number];

const nullableNumber = z.number().finite().nonnegative().nullable();
const controlSchema = z.object({
  id: uuid,
  tenant_id: uuid,
  dispatch_trip_id: uuid,
  driver_id: uuid,
  vehicle_id: uuid,
  status: z.enum(tripCargoStatuses),
  vehicle_checked: z.boolean(),
  tie_down_confirmed: z.boolean(),
  seal_not_applicable_reason: z.string().nullable(),
  updated_at: z.string(),
});
const loadSchema = z.object({
  id: uuid, load_id: uuid,
  expected_volume_count: nullableNumber,
  expected_pallet_count: z.number().int().nonnegative().nullable(),
  expected_weight_kg: nullableNumber,
  confirmed_volume_count: nullableNumber,
  confirmed_pallet_count: z.number().int().nonnegative().nullable(),
  confirmed_weight_kg: nullableNumber,
  confirmed_at: z.string().nullable(),
});
const documentSchema = z.object({
  id: uuid, load_id: uuid.nullable(),
  source_kind: z.enum(['nfe', 'nfse', 'cte', 'operational_reference']),
  reference_number: z.string().min(1).max(300),
  driver_confirmed: z.boolean(),
});
export const tripCargoSealStatuses = ['installed', 'removed', 'broken', 'missing'] as const;
const sealSchema = z.object({
  id: uuid,
  seal_number: z.string(),
  status: z.enum(tripCargoSealStatuses),
  installed_at: z.string(),
  installed_by: uuid,
  installed_evidence_id: uuid.nullable().optional(),
  installation_reason: z.string().optional(),
  resolved_at: z.string().nullable().optional(),
  resolved_by: uuid.nullable().optional(),
  resolution_reason: z.string().nullable().optional(),
  resolution_evidence_id: uuid.nullable().optional(),
  evidence_waived_legacy: z.boolean().optional(),
});
const evidenceSchema = z.object({ id: uuid, evidence_kind: z.string(), storage_path: z.string() });
const divergenceSchema = z.object({
  id: uuid, load_id: uuid.nullable(),
  divergence_kind: z.enum(['document', 'volume', 'pallet', 'weight', 'seal', 'damage', 'shortage', 'surplus', 'other']),
  description: z.string(), expected_value: z.string().nullable(), observed_value: z.string().nullable(),
  status: z.enum(['pending', 'approved', 'rejected', 'resolved']), review_reason: z.string().nullable(),
});
const physicalSchema = z.object({
  required_count: z.number().int().nonnegative(), pending_count: z.number().int().nonnegative(), missing_count: z.number().int().nonnegative(),
});
const unavailableSchema = z.object({
  version: z.literal(1), available: z.literal(false), tenant_id: uuid, trip_id: uuid,
  trip_status: z.string(), driver_id: uuid, vehicle_id: uuid.nullable(),
});
const availableSchema = z.object({
  version: z.literal(1), available: z.literal(true), trip_id: uuid, trip_status: z.string(),
  control: controlSchema, loads: z.array(loadSchema), documents: z.array(documentSchema),
  seals: z.array(sealSchema), evidence: z.array(evidenceSchema),
  divergences: z.array(divergenceSchema), collection_counts: z.object({
    loads: z.number().int().nonnegative(), documents: z.number().int().nonnegative(),
    seals: z.number().int().nonnegative(), evidence: z.number().int().nonnegative(), divergences: z.number().int().nonnegative(),
  }), physical_receipts: physicalSchema,
});
const snapshotSchema = z.discriminatedUnion('available', [unavailableSchema, availableSchema]);
const acknowledgementSchema = z.object({
  version: z.literal(1), confirmed: z.literal(true), trip_id: uuid, control_id: uuid,
  status: z.enum(tripCargoStatuses), updated_at: z.string().optional(),
});
const listSchema = z.object({
  version: z.literal(2), tenant_id: uuid, total_count: z.number().int().nonnegative(),
  page: z.number().int().positive(), page_size: z.number().int().min(1).max(100),
  revision: z.string().regex(/^[a-f0-9]{32}$/),
  items: z.array(z.object({
    id: uuid, trip_id: uuid, driver_id: uuid, vehicle_id: uuid, status: z.enum(tripCargoStatuses),
    updated_at: z.string(), pending_divergences: z.number().int().nonnegative(), pending_physical_receipts: z.number().int().nonnegative(),
  })).max(100),
});

const collectionCountSchema = z.object({
  loads: z.number().int().nonnegative(), documents: z.number().int().nonnegative(),
  seals: z.number().int().nonnegative(), evidence: z.number().int().nonnegative(),
  divergences: z.number().int().nonnegative(),
});
const baseSnapshotSchema = z.discriminatedUnion('available', [
  z.object({
    version: z.literal(2), available: z.literal(false), tenant_id: uuid, trip_id: uuid,
    trip_status: z.string(), driver_id: uuid, vehicle_id: uuid.nullable(),
  }),
  z.object({
    version: z.literal(2), available: z.literal(true), tenant_id: uuid, trip_id: uuid,
    trip_status: z.string(), control: controlSchema, collection_counts: collectionCountSchema,
    physical_receipts: physicalSchema,
  }),
]);
const collectionNameSchema = z.enum(['loads', 'documents', 'seals', 'evidence', 'divergences']);
export type TripCargoCollection = z.infer<typeof collectionNameSchema>;
const collectionPageSchema = z.object({
  version: z.literal(1), tenant_id: uuid, trip_id: uuid, collection: collectionNameSchema,
  page: z.number().int().positive(), page_size: z.number().int().min(1).max(500),
  total_count: z.number().int().nonnegative(), items: z.array(z.unknown()).max(500),
});

export type TripCargoSnapshot = z.infer<typeof snapshotSchema>;
export type TripCargoAvailableSnapshot = z.infer<typeof availableSchema>;
export type TripCargoList = z.infer<typeof listSchema>;
export type TripCargoDivergenceStatus = TripCargoAvailableSnapshot['divergences'][number]['status'];
export type TripCargoDivergenceKind = TripCargoAvailableSnapshot['divergences'][number]['divergence_kind'];
type TripCargoCollectionItems = {
  loads: TripCargoAvailableSnapshot['loads']; documents: TripCargoAvailableSnapshot['documents'];
  seals: TripCargoAvailableSnapshot['seals']; evidence: TripCargoAvailableSnapshot['evidence'];
  divergences: TripCargoAvailableSnapshot['divergences'];
};
export type TripCargoCollectionPage<C extends TripCargoCollection> = {
  page:number; pageSize:number; total:number; items:TripCargoCollectionItems[C];
};

export interface TripCargoDivergenceCommand {
  kind: TripCargoDivergenceKind;
  description: string;
  load_id?: string;
  document_check_id?: string;
  /**
   * Compatibility field consumed by the current database trigger while the
   * explicit document_check_id remains present in the command contract.
   */
  observed_value?: string;
}

const loadScopedDivergenceKinds = new Set<TripCargoDivergenceKind>([
  'damage', 'shortage', 'surplus', 'volume', 'pallet', 'weight',
]);

export function buildTripCargoDivergenceCommand(input: {
  kind: string;
  description: string;
  loadId?: string | null;
  documentCheckId?: string | null;
  loads: TripCargoAvailableSnapshot['loads'];
  documents: TripCargoAvailableSnapshot['documents'];
}): TripCargoDivergenceCommand | null {
  if (!input.kind) return null;
  const kind = divergenceSchema.shape.divergence_kind.parse(input.kind);
  const description = input.description.trim();
  if (description.length < 5) throw new Error('Descreva a divergência com pelo menos 5 caracteres.');

  const selectedLoad = input.loadId
    ? input.loads.find(load => load.load_id === input.loadId)
    : null;
  if (input.loadId && !selectedLoad) throw new Error('A carga afetada não pertence a esta viagem.');

  if (kind === 'document') {
    const selectedDocument = input.documentCheckId
      ? input.documents.find(document => document.id === input.documentCheckId)
      : input.documents.length === 1 ? input.documents[0] : null;
    if (!selectedDocument) throw new Error('Selecione o documento afetado.');
    if (selectedLoad && selectedDocument.load_id && selectedDocument.load_id !== selectedLoad.load_id) {
      throw new Error('O documento selecionado não pertence à carga afetada.');
    }
    const loadId = selectedDocument.load_id ?? selectedLoad?.load_id;
    return {
      kind,
      description,
      ...(loadId ? { load_id: loadId } : {}),
      document_check_id: selectedDocument.id,
      observed_value: selectedDocument.id,
    };
  }

  const automaticallyScopedLoad = input.loads.length === 1 ? input.loads[0] : null;
  const effectiveLoad = selectedLoad ?? automaticallyScopedLoad;
  if (input.loads.length > 1 && loadScopedDivergenceKinds.has(kind) && !effectiveLoad) {
    throw new Error('Selecione a carga afetada.');
  }
  return {
    kind,
    description,
    ...(effectiveLoad ? { load_id: effectiveLoad.load_id } : {}),
  };
}

type RpcResult = PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => RpcResult;

function invalidResponse() {
  return new Error('O servidor retornou um dossiê de carga inválido. Atualize antes de continuar.');
}

export async function getTripCargoControl(tenantId: string, tripId: string): Promise<TripCargoSnapshot> {
  const { data, error } = await rpc('get_trip_cargo_control_v2', { _tenant_id: tenantId, _trip_id: tripId });
  if (error) throw new Error(error.message || 'Não foi possível consultar o dossiê de carga.');
  const base = baseSnapshotSchema.safeParse(data);
  if (!base.success || base.data.tenant_id !== tenantId || base.data.trip_id !== tripId) throw invalidResponse();
  if (!base.data.available) return snapshotSchema.parse({ ...base.data, version: 1 });
  const [loads, documents, seals, evidence, divergences] = await Promise.all([
    getTripCargoCollectionPage(tenantId, tripId, 'loads', 1, 50, base.data.collection_counts.loads),
    getTripCargoCollectionPage(tenantId, tripId, 'documents', 1, 50, base.data.collection_counts.documents),
    getTripCargoCollectionPage(tenantId, tripId, 'seals', 1, 50, base.data.collection_counts.seals),
    getTripCargoCollectionPage(tenantId, tripId, 'evidence', 1, 50, base.data.collection_counts.evidence),
    getTripCargoCollectionPage(tenantId, tripId, 'divergences', 1, 50, base.data.collection_counts.divergences),
  ]);
  const parsed = snapshotSchema.safeParse({
    version: 1, available: true, trip_id: base.data.trip_id, trip_status: base.data.trip_status,
    control: base.data.control, physical_receipts: base.data.physical_receipts,
    loads:loads.items, documents:documents.items, seals:seals.items, evidence:evidence.items, divergences:divergences.items,
    collection_counts:base.data.collection_counts,
  });
  if (!parsed.success) throw invalidResponse();
  return parsed.data;
}

const tripCargoCollectionItemSchemas = {
  loads: loadSchema, documents: documentSchema, seals: sealSchema, evidence: evidenceSchema, divergences: divergenceSchema,
} as const;

export async function getTripCargoCollectionPage<C extends TripCargoCollection>(
  tenantId: string,
  tripId: string,
  collection: C,
  page: number,
  pageSize = 50,
  expectedTotal?: number,
): Promise<TripCargoCollectionPage<C>> {
  const { data, error } = await rpc('get_trip_cargo_collection_page_v1', {
    _tenant_id: tenantId, _trip_id: tripId, _collection: collection, _page: page, _page_size: pageSize,
  });
  if (error) throw new Error(error.message || 'Não foi possível consultar uma seção do dossiê.');
  const parsed = collectionPageSchema.safeParse(data);
  if (!parsed.success || parsed.data.tenant_id !== tenantId || parsed.data.trip_id !== tripId
    || parsed.data.collection !== collection || parsed.data.page !== page || parsed.data.page_size !== pageSize
    || (expectedTotal !== undefined && parsed.data.total_count !== expectedTotal)) throw invalidResponse();
  const items = z.array(tripCargoCollectionItemSchemas[collection]).safeParse(parsed.data.items);
  if (!items.success || new Set(items.data.map(item=>item.id)).size !== items.data.length) throw invalidResponse();
  return {page,pageSize,total:parsed.data.total_count,items:items.data} as TripCargoCollectionPage<C>;
}

export type DriverTripCargoAction = 'accept' | 'start_loading' | 'confirm_cargo' | 'mark_departed' | 'resolve_seals' | 'mark_returned';
export async function updateDriverTripCargo(input: {
  tenantId: string; tripId: string; requestId: string; action: DriverTripCargoAction; payload?: Record<string, unknown>;
}) {
  const { data, error } = await rpc('driver_update_trip_cargo_v1', {
    _tenant_id: input.tenantId, _trip_id: input.tripId, _request_id: input.requestId,
    _action: input.action, _payload: input.payload ?? {},
  });
  if (error) throw new Error(error.message || 'Não foi possível atualizar a custódia da carga.');
  const parsed = acknowledgementSchema.safeParse(data);
  if (!parsed.success || parsed.data.trip_id !== input.tripId) throw invalidResponse();
  return parsed.data;
}

const tripCargoListRevisions=new Map<string,string>();
export class TripCargoListChangedError extends Error {}
export async function listTripCargoControls(
  tenantId: string,
  status?: TripCargoStatus | null,
  page = 1,
  pageSize = 50,
): Promise<TripCargoList> {
  const key=`${tenantId}:${status??''}`,expected=page===1?null:tripCargoListRevisions.get(key);
  if(page>1&&!expected)throw new TripCargoListChangedError('Atualize a primeira página antes de continuar.');
  const { data, error } = await rpc('list_trip_cargo_controls_v2', {
    _tenant_id: tenantId, _status: status ?? null, _page: page, _page_size: pageSize, _expected_revision: expected,
  });
  if (error) {if(error.code==='40001')throw new TripCargoListChangedError('As custódias mudaram. A lista voltou à primeira página.');throw new Error(error.message || 'Não foi possível listar as custódias de carga.');}
  const parsed = listSchema.safeParse(data);
  if (!parsed.success || parsed.data.tenant_id !== tenantId || expected&&parsed.data.revision!==expected) throw invalidResponse();
  if(page===1)tripCargoListRevisions.set(key,parsed.data.revision);
  return parsed.data;
}

export async function reviewTripCargoDivergence(input: {
  tenantId: string; actorId: string; divergenceId: string;
  status: Exclude<TripCargoDivergenceStatus, 'pending'>; reason: string;
}) {
  const payload = { divergence_id: input.divergenceId, status: input.status, reason: input.reason.trim() };
  const pending = await prepareDurableOperatorCommand({
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: 'review_trip_cargo_divergence',
    entityId: input.divergenceId,
    payload,
  });
  const { data, error } = await rpc('review_trip_cargo_divergence_v2', {
    _tenant_id: input.tenantId, _divergence_id: input.divergenceId, _request_id: pending.requestId,
    _status: input.status, _reason: input.reason,
  });
  if (error) throw new Error(error.message || 'Não foi possível revisar a divergência.');
  const result = z.object({ version: z.literal(1), confirmed: z.literal(true), id: uuid, request_id: uuid,
    idempotent: z.boolean(), status: z.enum(['approved', 'rejected', 'resolved']),
    control_status: z.enum(tripCargoStatuses), updated_at: z.string() }).parse(data);
  if (result.request_id !== pending.requestId) throw invalidResponse();
  acknowledgeDurableOperatorCommand(pending);
  return result;
}

export async function closeTripCargo(input: { tenantId: string; tripId: string; overrideReason?: string | null }) {
  const { data, error } = await rpc('close_trip_cargo_v1', {
    _tenant_id: input.tenantId, _trip_id: input.tripId, _override_reason: input.overrideReason ?? null,
  });
  if (error) throw new Error(error.message || 'Não foi possível encerrar a custódia da viagem.');
  return z.object({ version: z.literal(1), confirmed: z.literal(true), trip_id: uuid, control_id: uuid,
    status: z.literal('closed'), changed: z.boolean(), override: z.boolean().optional(),
    pending_receipts: z.number().int().optional(), missing_receipts: z.number().int().optional() }).parse(data);
}

export const tripCargoStatusLabels: Record<TripCargoStatus, string> = {
  pending_acceptance: 'Aguardando aceite', accepted: 'Viagem aceita', loading: 'Em carregamento',
  ready_to_depart: 'Carga liberada', departed: 'Em custódia do motorista', returned: 'Retornada à base', closed: 'Custódia encerrada',
};

export const tripCargoDocumentLabels = { nfe: 'NF-e', nfse: 'NFS-e', cte: 'CT-e', operational_reference: 'Referência operacional' } as const;

export const tripCargoSealStatusLabels: Record<typeof tripCargoSealStatuses[number], string> = {
  installed: 'Instalado', removed: 'Removido íntegro', broken: 'Rompido', missing: 'Ausente',
};
