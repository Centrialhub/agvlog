import type { QueryClient } from '@tanstack/react-query';
import { invalidateTripLoadQueries } from '@/lib/tripMutation';

export interface MoveLoadItemsRequest {
  sourceLoadId: string;
  targetLoadId: string;
  items: { id: string; fiscalDocumentId: string | null }[];
}

export interface ConfirmedItemMove {
  moved: number;
  source_load_id: string;
  target_load_id: string;
  document_ids: string[];
  source_removed: boolean;
}

export function isConfirmedItemMove(data: unknown, request: MoveLoadItemsRequest): data is ConfirmedItemMove {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const result = data as Record<string, unknown>;
  const docs = new Set(request.items.flatMap(item => item.fiscalDocumentId ? [item.fiscalDocumentId] : []));
  return request.items.length > 0 && result.moved === request.items.length
    && result.source_load_id === request.sourceLoadId && result.target_load_id === request.targetLoadId
    && typeof result.source_removed === 'boolean' && Array.isArray(result.document_ids)
    && result.document_ids.length === docs.size && new Set(result.document_ids).size === docs.size
    && result.document_ids.every(id => typeof id === 'string' && docs.has(id));
}

export const COMPOSITION_QUERY_KEYS = [
  'load_items', 'load_documents', 'load-documents', 'fiscal_documents', 'reallocation_load_meta',
  'dispatch_stops', 'dispatch_stop_documents', 'route_planning_drafts',
  'driver_delivery_stops', 'driver_stop_products',
  'load_replanning_context',
  'load_document_change_context', 'load_item_pull_fiscal_docs',
  'operation_document_context', 'driver_settlements', 'driver_settlement', 'portal_shipments', 'portal_pods',
  'redelivery_context',
  'portal_documents', 'portal_reports_summary', 'portal_tracking', 'portal_upcoming', 'portal_shipment_detail_v2',
] as const;

export async function invalidateCompositionQueries(client: QueryClient) {
  await Promise.allSettled([
    invalidateTripLoadQueries(client),
    ...COMPOSITION_QUERY_KEYS.map(key => client.invalidateQueries({ queryKey: [key] })),
  ]);
}

export function compositionMutationError(error: unknown): Error & { code?: string; outcome: 'rejected' | 'unconfirmed' } {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = typeof value.code === 'string' ? value.code : undefined;
  const raw = typeof value.message === 'string' ? value.message : '';
  // An aborted fetch or missing body does not prove that the transaction rolled back.
  const rejected = !!code && (/^(22|23)/.test(code) || ['40001', '40P01', '55P03', '42501', 'P0001'].includes(code));
  let message = 'Não foi possível confirmar a realocação. Confira as duas cargas atualizadas antes de selecionar e enviar novamente; a movimentação pode ter sido concluída.';
  if (rejected) {
    message = 'A realocação foi recusada. Confira a composição atual das duas cargas antes de selecionar novamente.';
    if (raw.includes('composition_requires_replanning')) message = 'Estas cargas pertencem a viagens diferentes. A realocação exige replanejamento explícito das paradas pela operação.';
    else if (raw.includes('explicit_document_stop_required')) message = 'Selecione explicitamente uma parada na confirmação da inclusão. A nota não foi adicionada.';
    else if (raw.includes('document_already_linked')) message = 'A nota já está em uma carga. Use a realocação/replanejamento para transferi-la com seus vínculos.';
    else if (raw.includes('invalid_inbound_document')) message = 'A seleção contém documento excluído ou que não é uma nota de entrada. Atualize a seleção.';
    else if (raw.includes('document_selection_changed')) message = 'A nota não pertence mais à composição selecionada. Atualize a carga antes de confirmar.';
    else if (raw.includes('replanning_has_delivery_evidence')) message = 'Há comprovante ou registro de recebimento nesta nota. A operação precisa revisar a entrega antes de replanejar.';
    else if (raw.includes('replanning_requires_fiscal_review')) message = 'A nota já possui resultado final ou documento fiscal emitido. Revise o vínculo fiscal antes de replanejar; nenhuma emissão ou cancelamento foi solicitado.';
    else if (raw.includes('composition_stop_coverage_mismatch') || raw.includes('composition_stop_graph_mismatch')) message = 'A composição e as paradas estão divergentes. Revise os vínculos na operação antes de replanejar.';
    else if (raw.includes('composition_document_split_not_allowed')) message = 'Selecione todos os itens da mesma nota fiscal; uma nota não pode ser dividida entre cargas.';
    else if (raw.includes('load_locked')) message = 'A carga ou sua viagem já iniciou o transporte ou foi encerrada. A composição não pode ser alterada.';
    else if (code === '42501') message = 'Sua sessão não tem permissão para realocar itens nesta empresa.';
    else if (['40001', '40P01', '55P03'].includes(code)) message = 'Outra operação alterou a carga ou a viagem. Esta tentativa foi desfeita; confira os dados e selecione novamente.';
  }
  if (code === 'CONTEXT_CHANGED') message = 'A sessão ou empresa mudou. Confira o resultado na empresa original antes de continuar.';
  return Object.assign(new Error(message), { code, outcome: rejected ? 'rejected' as const : 'unconfirmed' as const });
}
