import { z } from 'zod';
import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { removeSecureFiles, uploadSecureFile } from '@/lib/secureUpload';
import { validateUploadFile } from '@/lib/uploadPolicy';
import { invalidateCompositionQueries } from '@/lib/loads/compositionMutation';

const outcomes: Record<string, string> = {
  entregue: 'delivered', devolucao_parcial: 'partial_delivery', devolucao_total: 'returned',
  cliente_recusou: 'refused', cliente_estava_fora: 'failed',
};
const noteTypes = new Set(['avaria','solicitar_desconto','atualizar_boleto','coleta_realizada','outros']);
const resultSchema = z.object({event_id:z.string().uuid(), operational_event_id:z.string().uuid(), replayed:z.boolean()}).passthrough();
export type DeliverySubmissionResult = z.infer<typeof resultSchema>;
// These PostgreSQL responses explicitly reject/roll back the current transaction.
// Network errors, malformed responses and an earlier uncertain attempt are never
// evidence that uploaded proofs can be discarded.
const rejectedSqlStates = new Set(['22023','23514','40001','40P01','42501','P0002']);
export interface DeliverySubmissionInput {
  tenantId: string; tripId: string; stopId: string; expectedStatus: string; eventKey: string;
  photos: File[]; signatureDataUrl: string | null; details: Record<string, Json>;
}

export function deliveryOutcome(eventKey: string) { return outcomes[eventKey]; }
export function deliveryErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Não foi possível confirmar o envio. Tente novamente com os mesmos dados.';
}

/** An immutable snapshot keeps its request key; uncertain retries reuse its uploads.
 * Files are cleaned up before an RPC or after its unambiguous transactional rejection.
 * Once any response is lost, preserve the snapshot and proofs until a confirmed replay.
 * This in-memory retry does not replace a future durable offline outbox across page reloads.
 */
export function createDeliverySubmission(input: DeliverySubmissionInput) {
  const {tenantId,tripId,stopId,eventKey,expectedStatus} = input;
  const outcome = deliveryOutcome(eventKey);
  if (!tenantId || !tripId || !stopId || (!outcome && !noteTypes.has(eventKey))) throw new Error('Evento ou viagem inválidos.');
  const details = structuredClone(input.details);
  const photos = [...input.photos];
  const signatureDataUrl = input.signatureDataUrl;
  if (photos.length > 5) throw new Error('Envie no máximo cinco fotos.');
  photos.forEach(file => validateUploadFile(file,'image'));
  if (outcome === 'delivered' || outcome === 'partial_delivery') {
    if (typeof details.receiver_name !== 'string' || details.receiver_name.trim().length < 2) throw new Error('Informe o recebedor.');
    if (!photos.length || !signatureDataUrl) throw new Error('Adicione foto e assinatura para comprovar a entrega.');
  }
  if (outcome !== 'delivered' && (typeof details.notes !== 'string' || details.notes.trim().length < 3)) {
    throw new Error('Informe o motivo ou a descrição da comunicação.');
  }
  if ((eventKey === 'avaria' || eventKey === 'coleta_realizada') && !photos.length) throw new Error('Adicione uma foto.');
  const requestId = crypto.randomUUID();
  let prepared: Record<string, Json> | null = null;
  let dispatched = false;
  let canRevise = true;
  let uncertainOutcome = false;
  let cleanupPending = false;
  let inFlight: Promise<DeliverySubmissionResult> | null = null;
  const uploaded: string[] = [];

  async function discardRejectedFiles(cause: unknown) {
    cleanupPending=true;
    try {
      if (uploaded.length) await removeSecureFiles(tenantId,'receipts',[...uploaded]);
      uploaded.length=0;
      prepared=null;
      cleanupPending=false;
      canRevise=true;
    } catch {
      canRevise=false;
      throw new Error(`${deliveryErrorMessage(cause)} Há anexos pendentes de limpeza; tente novamente ou avise a operação.`);
    }
  }

  async function prepare() {
    if (cleanupPending) await discardRejectedFiles(new Error('Não foi possível limpar os anexos do envio rejeitado.'));
    if (prepared) return prepared;
    try {
      const results = await Promise.allSettled(photos.map(file => uploadSecureFile({tenantId,bucket:'receipts',
        folder:`deliveries/${tripId}/${stopId}`,file,kind:'image'})));
      const paths: string[] = [];
      for (const result of results) if (result.status === 'fulfilled') { paths.push(result.value); uploaded.push(result.value); }
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      let signature: string | null = null;
      if (signatureDataUrl) {
        const blob = await (await fetch(signatureDataUrl)).blob();
        signature = await uploadSecureFile({tenantId,bucket:'receipts',folder:`deliveries/${tripId}/${stopId}/signatures`,
          file:new File([blob],'assinatura.png',{type:'image/png'}),kind:'image'});
        uploaded.push(signature);
      }
      prepared = {...details,photo_paths:paths,photo_count:paths.length,signature_path:signature};
      return prepared;
    } catch (error) {
      if (uploaded.length && !uncertainOutcome) {
        await discardRejectedFiles(error);
      }
      throw error;
    }
  }
  async function run() {
    const payload = await prepare();
    dispatched = true;
    canRevise = false;
    try {
      const response = outcome
        ? await supabase.rpc('driver_record_delivery_outcome',{_stop_id:stopId,_outcome:outcome,_details:payload,
          _client_event_id:requestId,_expected_status:expectedStatus})
        : await supabase.rpc('driver_record_delivery_note',{_stop_id:stopId,_event_type:eventKey,_details:payload,_client_event_id:requestId});
      if (response.error) {
        if (!uncertainOutcome && rejectedSqlStates.has(response.error.code)) {
          await discardRejectedFiles(response.error);
        }
        throw response.error;
      }
      return resultSchema.parse(response.data);
    } catch (error) {
      if (!canRevise && !cleanupPending) uncertainOutcome=true;
      throw error;
    }
  }
  return {
    get dispatched() { return dispatched; },
    get canRevise() { return canRevise; },
    submit() {
      if (!inFlight) inFlight = run().finally(() => { inFlight=null; });
      return inFlight;
    },
  };
}

export async function invalidateDeliveryQueries(client: QueryClient) {
  // A failed refresh cannot turn an already committed delivery into an error.
  // Use the shared graph keys so the operation and portal receive the same result.
  await Promise.allSettled([invalidateCompositionQueries(client), ...['driver_delivery_stops','driver_stops','driver_stop_products','driver_active_trip','driver_trip',
    'driver_trip_specific','driver_loads','driver_events','driver_event_detail','loads','dispatch_trips',
    'fiscal_documents','load_items','operational_events','pod-history','product-history','load-control','load-documents','load-unloading']
    .map(key => client.invalidateQueries({queryKey:[key]}))]);
}
