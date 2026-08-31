import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { compositionMutationError, invalidateCompositionQueries } from '@/lib/loads/compositionMutation';
import { createDocumentChangeOutbox, pendingDocumentChanges, DOCUMENT_CHANGE_CHANGED } from '@/lib/loads/documentChangesOutbox';
import { isRecord, type DocumentChangePayload, type DocumentChangeResult } from '@/lib/loads/documentChanges';

export function useLoadDocumentChanges() {
  const { currentTenant } = useTenant(); const { user } = useAuth(); const client = useQueryClient();
  const tenant = currentTenant?.id; const actor = user?.id;
  const context = useRef({ tenant, actor }); context.current = { tenant, actor };
  const busy = useRef(false); const [isPending, setPending] = useState(false); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('storage', refresh); window.addEventListener(DOCUMENT_CHANGE_CHANGED, refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener(DOCUMENT_CHANGE_CHANGED, refresh); };
  }, []);
  const assertContext = useCallback(() => {
    if (context.current.tenant !== tenant || context.current.actor !== actor) throw new Error('A sessão ou empresa mudou. Recupere a solicitação na empresa original.');
  }, [tenant, actor]);
  const outbox = useMemo(() => createDocumentChangeOutbox({
    get storage() { return window.localStorage; }, uuid: () => crypto.randomUUID(), assertContext,
    changed: () => window.dispatchEvent(new Event(DOCUMENT_CHANGE_CHANGED)),
    lock: async (key, work) => {
      if (!navigator.locks) throw new Error('Use um navegador atualizado em conexão segura para recuperar solicitações entre abas.');
      return navigator.locks.request(key, work);
    },
    send: async payload => {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30_000);
      try { return await supabase.rpc('change_load_documents', { _payload: JSON.parse(JSON.stringify(payload)) }).abortSignal(controller.signal); }
      finally { clearTimeout(timer); }
    },
  }), [assertContext]);
  const pending = useMemo(() => {
    try { return { items: tenant && actor ? pendingDocumentChanges(window.localStorage, tenant, actor) : [], error: null }; }
    catch (error) { return { items: [], error: error instanceof Error ? error.message : 'Falha na recuperação local.' }; }
  }, [tenant, actor, revision]);
  const run = useCallback(async (work: () => Promise<DocumentChangeResult>) => {
    if (!tenant || !actor) throw new Error('Selecione a empresa e entre com uma sessão válida.');
    if (busy.current) throw new Error('Aguarde a alteração de documentos em andamento.');
    assertContext(); busy.current = true; setPending(true); let result: DocumentChangeResult;
    try { result = await work(); }
    catch (error) { throw isRecord(error) && typeof error.code === 'string' ? compositionMutationError(error) : error; }
    finally { await invalidateCompositionQueries(client); busy.current = false; setPending(false); }
    assertContext(); return result;
  }, [tenant, actor, assertContext, client]);
  return { isPending, pending: pending.items, recoveryError: pending.error,
    submit: (payload: Omit<DocumentChangePayload, 'tenant_id'>) => run(() => outbox.submit(tenant!, actor!, { ...payload, tenant_id: tenant! })),
    recover: (scope: string) => run(() => outbox.recover(tenant!, actor!, scope)),
  };
}
