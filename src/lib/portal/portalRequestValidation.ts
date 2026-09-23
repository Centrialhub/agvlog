import { localDateTimeInputToIso } from '@/lib/utils/formatDate';

export const PORTAL_OCCURRENCE_EVENT_TYPE_MAX_LENGTH = 80;
export const PORTAL_OCCURRENCE_DESCRIPTION_MAX_LENGTH = 2_000;
export const PORTAL_PICKUP_RECIPIENT_MAX_LENGTH = 300;
export const PORTAL_PICKUP_NOTES_MAX_LENGTH = 2_000;
export const PORTAL_PICKUP_CANCELLATION_REASON_MAX_LENGTH = 500;
export const PORTAL_OCCURRENCE_MESSAGE_MAX_LENGTH = 4_000;

const OCCURRENCE_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

type PortalOccurrenceInput = {
  client_id: string;
  event_type: string;
  severity: string;
  description: string;
};

export function normalizePortalOccurrence<T extends PortalOccurrenceInput>(input: T): T {
  const eventType = input.event_type.trim();
  const description = input.description.trim();
  const severity = input.severity.trim().toLowerCase();

  if (eventType.length < 2 || eventType.length > PORTAL_OCCURRENCE_EVENT_TYPE_MAX_LENGTH) {
    throw new Error(`O tipo deve ter entre 2 e ${PORTAL_OCCURRENCE_EVENT_TYPE_MAX_LENGTH} caracteres.`);
  }
  if (description.length < 10 || description.length > PORTAL_OCCURRENCE_DESCRIPTION_MAX_LENGTH) {
    throw new Error(`A descrição deve ter entre 10 e ${PORTAL_OCCURRENCE_DESCRIPTION_MAX_LENGTH} caracteres.`);
  }
  if (!OCCURRENCE_SEVERITIES.has(severity)) {
    throw new Error('Selecione uma gravidade válida.');
  }

  return { ...input, event_type: eventType, description, severity };
}

export function futurePortalPickupIso(value: string, now = Date.now(), timeZone?: string): string {
  const iso = localDateTimeInputToIso(value, timeZone);
  if (Date.parse(iso) <= now) {
    throw new Error('A data e hora da coleta devem estar no futuro.');
  }
  return iso;
}

export function normalizePortalPickupCancellationReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 10 || reason.length > PORTAL_PICKUP_CANCELLATION_REASON_MAX_LENGTH) {
    throw new Error(`O motivo deve ter entre 10 e ${PORTAL_PICKUP_CANCELLATION_REASON_MAX_LENGTH} caracteres.`);
  }
  return reason;
}
