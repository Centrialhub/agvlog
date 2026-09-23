import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { useTenant } from './useTenant';
import { supabase } from '@/integrations/supabase/client';
import { createLoadCreationOutbox, readPendingLoadCreations, type LoadCreationInput, type LoadCreationKind } from '@/lib/loads/loadCreationOutbox';

export function useLoadCreation(kind: LoadCreationKind) {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const actor = user?.id; const tenant = currentTenant?.id;
  const latest = useRef({ actor, tenant }); latest.current = { actor, tenant };
  const alive = useRef(true); const running = useRef(false);
  const [revision, setRevision] = useState(0);
  const [isPending, setPending] = useState(false);
  useEffect(() => {
    alive.current = true;
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('storage', refresh);
    return () => { alive.current = false; window.removeEventListener('storage', refresh); };
  }, []);
  const outbox = useMemo(() => createLoadCreationOutbox({
    get storage() { return window.localStorage; }, uuid: () => crypto.randomUUID(),
    assertContext: () => {
      if (!alive.current || latest.current.actor !== actor || latest.current.tenant !== tenant) {
        throw new Error('A sessão ou empresa mudou. Recupere a criação na sessão original.');
      }
    },
    lock: (key, work) => {
      if (!navigator.locks) throw new Error('Use um navegador atualizado em conexão segura para criar cargas.');
      return navigator.locks.request(key, work);
    },
    send: async (mode, payload) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        return await supabase.rpc((mode === 'grouped' ? 'create_grouped_load_v1' : 'create_load_with_documents_v1') as never,
          { _payload: payload } as never).abortSignal(controller.signal);
      } finally { clearTimeout(timeout); }
    },
  }), [actor, tenant]);
  const recovery = useMemo(() => {
    try { return { revision, pending: actor && tenant ? readPendingLoadCreations(window.localStorage, tenant, actor, kind) : [], error: '' }; }
    catch (error) { return { revision, pending: [], error: error instanceof Error ? error.message : 'Não foi possível ler a criação pendente.' }; }
  // revision changes after each command, including an uncertain response.
  }, [actor, tenant, kind, revision]);
  const run = async (scope: string, input?: LoadCreationInput) => {
    if (!actor || !tenant) throw new Error('Entre com uma sessão válida e selecione a empresa.');
    if (running.current) throw new Error('Aguarde a criação em andamento.');
    running.current = true; setPending(true);
    try { return await outbox(tenant, actor, kind, scope, input); }
    finally { running.current = false; if (alive.current) { setPending(false); setRevision(value => value + 1); } }
  };
  return { ...recovery, isPending, submit: (scope: string, input: LoadCreationInput) => run(scope, input), recover: (scope: string) => run(scope) };
}
