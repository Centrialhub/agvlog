import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { compositionMutationError, invalidateCompositionQueries } from '@/lib/loads/compositionMutation';
import { createOperationOutcomeOutbox, pendingOperationOutcomes, OPERATION_OUTCOME_CHANGED } from '@/lib/loads/operationOutcomeOutbox';
import { isRecord, operationOutcomeMessage, type OperationDocumentContext, type OperationOutcomePayload, type OperationOutcomeResult } from '@/lib/loads/operationDocumentOutcome';

export function useOperationDocumentContext(loadId:string,documentId:string){
  const {currentTenant}=useTenant();const {user}=useAuth();const tenant=currentTenant?.id;const actor=user?.id;
  return useQuery({queryKey:['operation_document_context',tenant,actor,loadId,documentId],enabled:!!tenant&&!!actor&&!!loadId&&!!documentId,
    queryFn:async({signal})=>{
      const {data,error}=await supabase.rpc('get_operation_document_context',{_tenant_id:tenant!,_load_id:loadId,_document_id:documentId}).abortSignal(signal);
      if(error)throw new Error(operationOutcomeMessage(error));
      if(!isRecord(data)||data.tenant_id!==tenant||data.load_id!==loadId||data.document_id!==documentId||typeof data.revision!=='string'
        ||!Array.isArray(data.stops)||!Array.isArray(data.history))throw new Error('Contexto de entrega não confirmado.');
      return data as unknown as OperationDocumentContext;
    }});
}

export function useOperationDocumentOutcomes() {
  const { currentTenant } = useTenant(); const { user } = useAuth(); const client = useQueryClient();
  const tenant = currentTenant?.id; const actor = user?.id;
  const context = useRef({ tenant, actor }); context.current = { tenant, actor };
  const busy = useRef(false); const [isPending, setPending] = useState(false); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('storage', refresh); window.addEventListener(OPERATION_OUTCOME_CHANGED, refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener(OPERATION_OUTCOME_CHANGED, refresh); };
  }, []);
  const assertContext = useCallback(() => {
    if (context.current.tenant !== tenant || context.current.actor !== actor) throw new Error('A sessão ou empresa mudou. Recupere a solicitação na empresa original.');
  }, [tenant, actor]);
  const outbox = useMemo(() => createOperationOutcomeOutbox({
    get storage() { return window.localStorage; }, uuid: () => crypto.randomUUID(), assertContext,
    changed: () => window.dispatchEvent(new Event(OPERATION_OUTCOME_CHANGED)),
    lock: async (key, work) => {
      if (!navigator.locks) throw new Error('Use um navegador atualizado em conexão segura para recuperar solicitações entre abas.');
      return navigator.locks.request(key, work);
    },
    send: async payload => {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30_000);
      try { return await supabase.rpc(payload.correction_of?'record_operation_document_correction':'record_operation_document_outcome', { _payload: JSON.parse(JSON.stringify(payload)) }).abortSignal(controller.signal); }
      finally { clearTimeout(timer); }
    },
  }), [assertContext]);
  const pending = useMemo(() => {
    try { return { items: tenant && actor ? pendingOperationOutcomes(window.localStorage, tenant, actor) : [], error: null }; }
    catch (error) { return { items: [], error: error instanceof Error ? error.message : 'Falha na recuperação local.' }; }
  }, [tenant, actor, revision]);
  const run = useCallback(async (work: () => Promise<OperationOutcomeResult>) => {
    if (!tenant || !actor) throw new Error('Selecione a empresa e entre com uma sessão válida.');
    if (busy.current) throw new Error('Aguarde o resultado operacional em andamento.');
    assertContext(); busy.current = true; setPending(true); let result: OperationOutcomeResult;
    try { result = await work(); }
    catch (error) { if(isRecord(error)&&typeof error.code==='string'){const failure=compositionMutationError(error);failure.message=operationOutcomeMessage(error);throw failure;}throw error; }
    finally { await invalidateCompositionQueries(client); busy.current = false; setPending(false); }
    assertContext(); return result;
  }, [tenant, actor, assertContext, client]);
  return { isPending, pending: pending.items, recoveryError: pending.error,
    submit: (payload: Omit<OperationOutcomePayload, 'tenant_id'>) => run(() => outbox.submit(tenant!, actor!, { ...payload, tenant_id: tenant! })),
    recover: (scope: string) => run(() => outbox.recover(tenant!, actor!, scope)),
  };
}
