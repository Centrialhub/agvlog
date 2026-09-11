import type { Json } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';

export type DriverDeliveryFiscalSnapshotDocument = {
  kind: 'nfe' | 'nfse';
  document_id: string;
  allocation_id: string | null;
  load_id: string | null;
  attempt_id: string | null;
  status: string;
};

export type DriverDeliveryFiscalSnapshot = {
  version: 1;
  tenant_id: string;
  actor_id: string;
  trip_id: string;
  stop_id: string;
  captured_at: string;
  revision: string;
  documents: DriverDeliveryFiscalSnapshotDocument[];
};

function nullableId(value: unknown): value is string | null {
  return value === null || typeof value === 'string' && value.length > 0 && value.length <= 100;
}

export function readDriverDeliveryFiscalSnapshot(
  value: unknown,
  context: { tenant: string; actor: string; trip: string; stop: string },
): DriverDeliveryFiscalSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('O snapshot fiscal da parada é inválido.');
  const snapshot = value as Partial<DriverDeliveryFiscalSnapshot>;
  if (snapshot.version !== 1 || snapshot.tenant_id !== context.tenant || snapshot.actor_id !== context.actor
    || snapshot.trip_id !== context.trip || snapshot.stop_id !== context.stop
    || typeof snapshot.captured_at !== 'string' || !Number.isFinite(Date.parse(snapshot.captured_at))
    || typeof snapshot.revision !== 'string' || !/^[0-9a-f]{32}$/.test(snapshot.revision)
    || !Array.isArray(snapshot.documents) || snapshot.documents.length > 2_000) {
    throw new Error('Não foi possível conferir o snapshot fiscal desta parada e viagem.');
  }
  const identities = new Set<string>();
  for (const document of snapshot.documents) {
    if (!document || typeof document !== 'object' || !['nfe','nfse'].includes(document.kind)
      || typeof document.document_id !== 'string' || document.document_id.length < 1 || document.document_id.length > 100
      || !nullableId(document.allocation_id) || !nullableId(document.load_id) || !nullableId(document.attempt_id)
      || typeof document.status !== 'string' || document.status.length < 1 || document.status.length > 80) {
      throw new Error('O snapshot fiscal contém documentos inválidos.');
    }
    const identity = `${document.kind}:${document.document_id}:${document.allocation_id ?? ''}`;
    if (identities.has(identity)) throw new Error('O snapshot fiscal contém documentos duplicados.');
    identities.add(identity);
  }
  return structuredClone(snapshot as DriverDeliveryFiscalSnapshot);
}

export function fiscalSnapshotAsJson(snapshot: DriverDeliveryFiscalSnapshot): Json {
  return structuredClone(snapshot) as unknown as Json;
}

type FiscalSnapshotRpcResult = PromiseLike<{ data: unknown; error: { message?: string } | null }>;
const rpc = supabase.rpc as unknown as (
  name: string,
  args: Record<string, unknown>,
) => FiscalSnapshotRpcResult;

export async function getDriverDeliveryFiscalSnapshot(context: {
  tenant: string;
  actor: string;
  trip: string;
  stop: string;
}): Promise<DriverDeliveryFiscalSnapshot> {
  const { data, error } = await rpc('get_driver_delivery_fiscal_snapshot_v1', {
    _tenant_id: context.tenant,
    _trip_id: context.trip,
    _stop_id: context.stop,
  });
  if (error) throw error;
  return readDriverDeliveryFiscalSnapshot(data, context);
}
