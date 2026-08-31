import { isRecord } from '@/lib/loads/operationDocumentOutcome';
import { DOCUMENT_STATUSES } from '@/lib/status/documentStatus';

export function readDriverDeliveryItems(value: unknown, context: { tenant: string; actor: string; trip: string; stop: string }) {
  if (!isRecord(value) || value.tenant_id !== context.tenant || value.actor_id !== context.actor
    || value.trip_id !== context.trip || value.stop_id !== context.stop || !Array.isArray(value.items)) {
    throw new Error('Não foi possível conferir os itens desta parada e viagem.');
  }
  const ids = new Set<string>();
  return value.items.map(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)
      || typeof item.fiscal_document_id !== 'string' || !item.fiscal_document_id
      || typeof item.document_status !== 'string' || !(DOCUMENT_STATUSES as readonly string[]).includes(item.document_status)
      || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0
      || (item.item_description !== null && typeof item.item_description !== 'string')
      || typeof item.is_historical !== 'boolean'
      || (item.attempt_id !== null && typeof item.attempt_id !== 'string')) {
      throw new Error('Itens ou resultados da tentativa estão inconsistentes. Atualize antes de registrar a entrega.');
    }
    ids.add(item.id);
    return { id: item.id, sku: item.fiscal_document_id.slice(0, 8), name: item.item_description || 'Item',
      qty: item.quantity, unit: 'UN', price: 0, documentStatus: item.document_status };
  });
}
