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

const DRIVER_EVENT_LABELS: Record<string, string> = {
  missing_goods: 'Falta de mercadoria',
  missing_goods_fractional: 'Falta de mercadoria fracionada',
  wrong_quantity: 'Quantidade errada',
  client_refused: 'Cliente fechado ou recusa',
  no_order: 'Cliente não fez o pedido',
  expired_goods: 'Mercadoria vencida',
  near_expiration: 'Produto próximo do vencimento',
  damaged: 'Avaria',
  wrong_address: 'Endereço errado',
  partial_delivery: 'Entrega parcial',
  return: 'Devolução',
  returned: 'Devolução',
  wrong_product: 'Mercadoria invertida',
  boleto_extension: 'Prorrogação de boleto',
  delivery_delay: 'Atraso na entrega',
  delivered: 'Entrega concluída',
  other: 'Outra ocorrência',
};

const humanizeEventType = (eventType: string) => {
  const knownLabel = DRIVER_EVENT_LABELS[eventType];
  if (knownLabel) return knownLabel;

  const generatedLabel = eventType
    .replace(/^info_/, '')
    .split('_')
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ');
  return generatedLabel || 'Evento operacional';
};

const eventLabel = (eventType: string, rawLabel?: string) => {
  const label = rawLabel?.trim();
  if (/^(other|othe)$/i.test(label ?? '')) return 'Outra ocorrência';
  return label || humanizeEventType(eventType);
};

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
  row: Pick<Tables<'operational_events'>,'id'|'event_type'|'report_details'|'payload'|'description'|'created_at'>,
): DriverEventView {
  const details = jsonRecord(row.report_details);
  const payload = jsonRecord(row.payload);
  const type: DriverEventView['type'] = FINAL_EVENT_TYPES.has(row.event_type)
    ? 'finalizador'
    : 'informativo';
  const rawLabel = stringValue(details, 'label');
  return {
    id: row.id,
    type,
    code: row.event_type === 'other' ? '' : row.event_type.toUpperCase().slice(0, 4),
    label: eventLabel(row.event_type, rawLabel),
    stopName: stringValue(details, 'stop_name', 'client_name')
      ?? (payload.scope === 'trip' ? 'Viagem — sem parada específica' : 'Parada não identificada'),
    invoice: stringValue(details, 'invoice', 'nf') ?? stringValue(payload, 'invoice', 'nf'),
    receiver: stringValue(details, 'receiver_name'),
    document: stringValue(details, 'receiver_document'),
    observation: row.description ?? undefined,
    occurredAt: row.created_at,
    hasPhoto: details.has_photo === true,
    hasSignature: details.has_signature === true,
  };
}
