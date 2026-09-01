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
const outboxEntrySchema = z.object({
  requestId:z.string().uuid(), tenantId:z.string().min(1), actorId:z.string().min(1), tripId:z.string().min(1),
  stopId:z.string().min(1), expectedStatus:z.string().min(1), eventKey:z.string().min(1), outcome:z.string().nullable(),
  details:z.record(z.string(),z.unknown()).nullable(), uploaded:z.array(z.string()),
  state:z.enum(['preparing','dispatch_pending','cleanup_pending']),
  createdAt:z.string().datetime(), updatedAt:z.string().datetime(),
});
type DeliveryOutboxEntry = z.infer<typeof outboxEntrySchema>;
const outboxSchema = z.array(outboxEntrySchema);
const outboxKey = 'agvlog.driver.delivery.outbox.v1';
export type DeliverySubmissionResult = z.infer<typeof resultSchema>;
// These PostgreSQL responses explicitly reject/roll back the current transaction.
// Network errors, malformed responses and an earlier uncertain attempt are never
// evidence that uploaded proofs can be discarded.
const rejectedSqlStates = new Set(['22023','23514','40001','40P01','42501','P0002']);
export interface DeliverySubmissionInput {
  tenantId: string; actorId: string; tripId: string; stopId: string; expectedStatus: string; eventKey: string;
  photos: File[]; signatureDataUrl: string | null; details: Record<string, Json>;
}

export function deliveryOutcome(eventKey: string) { return outcomes[eventKey]; }
export function deliveryErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'Não foi possível confirmar o envio. Tente novamente com os mesmos dados.';
}

function readOutbox(): DeliveryOutboxEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(outboxKey);
    if (!raw) return [];
    const parsed = outboxSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function writeOutbox(entries: DeliveryOutboxEntry[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (entries.length) localStorage.setItem(outboxKey,JSON.stringify(entries));
    else localStorage.removeItem(outboxKey);
  } catch {
    // The in-memory retry remains valid when browser storage is unavailable.
  }
}

function upsertOutbox(entry: DeliveryOutboxEntry) {
  const entries = readOutbox();
  const index = entries.findIndex(item => item.requestId===entry.requestId);
  if (index >= 0) entries[index]=entry;
  else entries.push(entry);
  writeOutbox(entries);
}

function removeOutbox(requestId: string) {
  writeOutbox(readOutbox().filter(item => item.requestId!==requestId));
}

async function dispatchOutboxEntry(entry: DeliveryOutboxEntry) {
  if (!entry.details) throw new Error('O envio pendente não possui dados suficientes para ser retomado.');
  const details = entry.details as Record<string, Json>;
  return entry.outcome
    ? supabase.rpc('driver_record_delivery_outcome',{_stop_id:entry.stopId,_outcome:entry.outcome,_details:details,
      _client_event_id:entry.requestId,_expected_status:entry.expectedStatus})
    : supabase.rpc('driver_record_delivery_note',{_stop_id:entry.stopId,_event_type:entry.eventKey,_details:details,
      _client_event_id:entry.requestId});
}

export async function replayPendingDeliverySubmissions(tenantId: string, actorId: string) {
  const pending = readOutbox().filter(entry => entry.tenantId===tenantId && entry.actorId===actorId);
  let confirmed=0;
  let cleaned=0;
  for (const entry of pending) {
    if (entry.state!=='dispatch_pending') {
      try {
        if (entry.uploaded.length) await removeSecureFiles(entry.tenantId,'receipts',entry.uploaded);
        removeOutbox(entry.requestId);
        cleaned+=1;
      } catch (error) {
        upsertOutbox({...entry,state:'cleanup_pending',updatedAt:new Date().toISOString()});
        throw error;
      }
      continue;
    }
    const response = await dispatchOutboxEntry(entry);
    if (response.error) {
      if (!rejectedSqlStates.has(response.error.code)) throw response.error;
      try {
        if (entry.uploaded.length) await removeSecureFiles(entry.tenantId,'receipts',entry.uploaded);
        removeOutbox(entry.requestId);
        cleaned+=1;
      } catch {
        upsertOutbox({...entry,state:'cleanup_pending',updatedAt:new Date().toISOString()});
      }
      throw response.error;
    }
    resultSchema.parse(response.data);
    removeOutbox(entry.requestId);
    confirmed+=1;
  }
  return {confirmed,cleaned};
}

/** An immutable snapshot keeps its request key; uncertain retries reuse its uploads.
 * Files are cleaned up before an RPC or after its unambiguous transactional rejection.
 * Once any response is lost, preserve the snapshot and proofs until a confirmed replay.
 * The durable outbox stores only private object paths and the immutable RPC payload,
 * never the photo/signature bytes, and is scoped to the same tenant and actor.
 */
export function createDeliverySubmission(input: DeliverySubmissionInput) {
  const {tenantId,actorId,tripId,stopId,eventKey,expectedStatus} = input;
  const outcome = deliveryOutcome(eventKey);
  if (!tenantId || !actorId || !tripId || !stopId || (!outcome && !noteTypes.has(eventKey))) throw new Error('Evento ou viagem inválidos.');
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
  const createdAt = new Date().toISOString();

  function persist(state: DeliveryOutboxEntry['state'], storedDetails: Record<string, Json> | null = prepared) {
    upsertOutbox({requestId,tenantId,actorId,tripId,stopId,expectedStatus,eventKey,outcome:outcome ?? null,
      details:storedDetails,uploaded:[...uploaded],state,createdAt,updatedAt:new Date().toISOString()});
  }

  async function discardRejectedFiles(cause: unknown) {
    cleanupPending=true;
    persist('cleanup_pending');
    try {
      if (uploaded.length) await removeSecureFiles(tenantId,'receipts',[...uploaded]);
      uploaded.length=0;
      prepared=null;
      cleanupPending=false;
      canRevise=true;
      removeOutbox(requestId);
    } catch {
      canRevise=false;
      throw new Error(`${deliveryErrorMessage(cause)} Há anexos pendentes de limpeza; tente novamente ou avise a operação.`);
    }
  }

  async function prepare() {
    if (cleanupPending) await discardRejectedFiles(new Error('Não foi possível limpar os anexos do envio rejeitado.'));
    if (prepared) return prepared;
    try {
      const paths: string[] = [];
      for (const file of photos) {
        const path = await uploadSecureFile({tenantId,bucket:'receipts',folder:`deliveries/${tripId}/${stopId}`,file,kind:'image'});
        paths.push(path);
        uploaded.push(path);
        persist('preparing',null);
      }
      let signature: string | null = null;
      if (signatureDataUrl) {
        const blob = await (await fetch(signatureDataUrl)).blob();
        signature = await uploadSecureFile({tenantId,bucket:'receipts',folder:`deliveries/${tripId}/${stopId}/signatures`,
          file:new File([blob],'assinatura.png',{type:'image/png'}),kind:'image'});
        uploaded.push(signature);
        persist('preparing',null);
      }
      prepared = {...details,photo_paths:paths,photo_count:paths.length,signature_path:signature};
      persist('dispatch_pending',prepared);
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
      const result = resultSchema.parse(response.data);
      removeOutbox(requestId);
      return result;
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
