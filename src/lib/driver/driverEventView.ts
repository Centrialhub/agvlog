import type { Json, Tables } from '@/integrations/supabase/types';
import type { JsonObject } from '@/lib/jsonTypes';

export type DriverEventView = {
  id: string;
  type: 'finalizador' | 'informativo';
  code: string;
  label: string;
  stopName: string;
  invoice?: string;
  receiver?: string;
  document?: string;
  observation?: string;
  occurredAt: string;
  hasPhoto: boolean;
  hasSignature: boolean;
};

const FINAL_EVENT_TYPES = new Set([
  'delivered', 'refused', 'returned', 'partial_delivery', 'damaged', 'missing_goods',
  'delivery_completed', 'delivery_failed',
]);

function jsonRecord(value: Json | null): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stringValue(record: JsonObject, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

export function mapOperationalEventToDriverEvent(
  row: Tables<'operational_events'>,
): DriverEventView {
  const details = jsonRecord(row.report_details);
  const type: DriverEventView['type'] = FINAL_EVENT_TYPES.has(row.event_type)
    ? 'finalizador'
    : 'informativo';
  return {
    id: row.id,
    type,
    code: row.event_type.toUpperCase().slice(0, 4),
    label: stringValue(details, 'label') ?? row.event_type ?? 'Evento',
    stopName: stringValue(details, 'stop_name', 'client_name') ?? '—',
    invoice: stringValue(details, 'invoice', 'nf'),
    receiver: stringValue(details, 'receiver_name'),
    document: stringValue(details, 'receiver_document'),
    observation: row.description ?? undefined,
    occurredAt: row.created_at,
    hasPhoto: details.has_photo === true,
    hasSignature: details.has_signature === true,
  };
}
