export type ReplanningTarget = { mode: 'unassigned' } | { mode: 'existing'; stop_id: string } | {
  mode: 'new'; destination: string; latitude: number; longitude: number; client_id: string | null;
};
export interface ReplanningPayload {
  tenant_id: string; source_load_id: string; target_load_id: string; item_ids: string[];
  expected_document_ids: string[]; revision: string; reason: string; target_stop: ReplanningTarget;
}
export interface ReplanningContext {
  revision: string;
  loads: { id: string; trip_id: string | null; load_number: string | null }[];
  stops: { id: string; dispatch_trip_id: string; destination: string; stop_order: number; status: string }[];
  items: { id: string; load_id: string; fiscal_document_id: string | null }[];
}
export interface ReplanningResult {
  request_id: string; moved: number; source_load_id: string; target_load_id: string; document_ids: string[];
  target_stop_id: string | null; source_removed: boolean; retired_stop_ids: string[]; cancelled_trip_ids: string[];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const isUuidList = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === 'string' && uuid.test(id)) && new Set(value).size === value.length;
export function isReplanningPayload(value: unknown): value is ReplanningPayload {
  if (!isRecord(value) || typeof value.tenant_id !== 'string' || !value.tenant_id || typeof value.source_load_id !== 'string'
    || !uuid.test(value.source_load_id) || typeof value.target_load_id !== 'string' || !uuid.test(value.target_load_id)
    || value.source_load_id === value.target_load_id || !isUuidList(value.item_ids) || !value.item_ids.length
    || !isUuidList(value.expected_document_ids) || value.expected_document_ids.length > value.item_ids.length
    || typeof value.revision !== 'string' || !/^[0-9a-f]{64}$/.test(value.revision)
    || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 2000 || !isRecord(value.target_stop)) return false;
  const target = value.target_stop;
  if (target.mode === 'unassigned') return true;
  if (target.mode === 'existing') return typeof target.stop_id === 'string' && uuid.test(target.stop_id);
  return target.mode === 'new' && typeof target.destination === 'string' && !!target.destination.trim()
    && typeof target.latitude === 'number' && Number.isFinite(target.latitude) && Math.abs(target.latitude) <= 90
    && typeof target.longitude === 'number' && Number.isFinite(target.longitude) && Math.abs(target.longitude) <= 180
    && (target.client_id === null || typeof target.client_id === 'string' && uuid.test(target.client_id));
}
export function parseReplanningContext(value: unknown, source: string, target: string): ReplanningContext {
  if (!isRecord(value) || typeof value.revision !== 'string' || !/^[0-9a-f]{64}$/.test(value.revision)
    || !Array.isArray(value.loads) || !Array.isArray(value.stops) || !Array.isArray(value.items)
    || ![source, target].every(id => (value.loads as unknown[]).some(row => isRecord(row) && row.id === id))
    || !value.loads.every(row => isRecord(row) && typeof row.id === 'string' && (row.trip_id === null || typeof row.trip_id === 'string'))
    || !value.stops.every(row => isRecord(row) && typeof row.id === 'string' && typeof row.dispatch_trip_id === 'string'
      && typeof row.destination === 'string' && typeof row.status === 'string' && typeof row.stop_order === 'number')
    || !value.items.every(row => isRecord(row) && typeof row.id === 'string' && typeof row.load_id === 'string'
      && (row.fiscal_document_id === null || typeof row.fiscal_document_id === 'string'))) {
    throw new Error('O servidor não confirmou o contexto de replanejamento. Atualize antes de continuar.');
  }
  return value as unknown as ReplanningContext;
}
export function isConfirmedReplanning(value: unknown, payload: ReplanningPayload, requestId: string): value is ReplanningResult {
  if (!isRecord(value) || value.request_id !== requestId || value.source_load_id !== payload.source_load_id
    || value.target_load_id !== payload.target_load_id || value.moved !== payload.item_ids.length
    || typeof value.source_removed !== 'boolean' || !isUuidList(value.document_ids)
    || value.document_ids.length !== payload.expected_document_ids.length
    || !value.document_ids.every(id => payload.expected_document_ids.includes(id))
    || !isUuidList(value.retired_stop_ids) || !isUuidList(value.cancelled_trip_ids)) return false;
  return payload.target_stop.mode === 'unassigned' ? value.target_stop_id === null
    : payload.target_stop.mode === 'existing' ? value.target_stop_id === payload.target_stop.stop_id
      : typeof value.target_stop_id === 'string' && uuid.test(value.target_stop_id);
}
