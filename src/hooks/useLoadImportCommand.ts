import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { supabase } from '@/integrations/supabase/client';
import { loadImportError, type LoadImportCommandInput, type LoadImportResult } from '@/lib/loadImports/loadImportCommands';
import { createLoadImportOutbox, LOAD_IMPORT_COMMAND_CHANGED, pendingLoadImportCommand } from '@/lib/loadImports/loadImportOutbox';

export function useLoadImportCommand() {
  const queryClient = useQueryClient();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const actor = user?.id;
  const tenant = currentTenant?.id;
  const latest = useRef({ actor, tenant }); latest.current = { actor, tenant };
  const alive = useRef(true);
  const busy = useRef(false);
  const [isPending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    alive.current = true;
    const changed = () => setRevision(value => value + 1);
    window.addEventListener('storage', changed);
    window.addEventListener(LOAD_IMPORT_COMMAND_CHANGED, changed);
    return () => {
      alive.current = false;
      window.removeEventListener('storage', changed);
      window.removeEventListener(LOAD_IMPORT_COMMAND_CHANGED, changed);
    };
  }, []);

  const assertContext = useCallback(() => {
    if (!alive.current || latest.current.actor !== actor || latest.current.tenant !== tenant) {
      throw new Error('A sessão ou empresa mudou. Recupere a importação na sessão original.');
    }
  }, [actor, tenant]);

  const outbox = useMemo(() => createLoadImportOutbox({
    get storage() { return window.localStorage; },
    uuid: () => crypto.randomUUID(), assertContext,
    changed: () => window.dispatchEvent(new Event(LOAD_IMPORT_COMMAND_CHANGED)),
    lock: async (key, work) => {
      if (!navigator.locks) throw new Error('Use um navegador atualizado em conexão segura para importar cargas.');
      return navigator.locks.request(key, work);
    },
    send: async payload => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        return await supabase.rpc('apply_load_import_command', {
          _payload: JSON.parse(JSON.stringify(payload)),
        }).abortSignal(controller.signal);
      } finally { clearTimeout(timeout); }
    },
  }), [assertContext]);

  const recovery = useMemo(() => {
    try {
      return { revision, pending: tenant && actor ? pendingLoadImportCommand(window.localStorage, tenant, actor) : null, error: null };
    } catch (cause) { return { revision, pending: null, error: loadImportError(cause) }; }
  }, [tenant, actor, revision]);

  const run = async (work: () => Promise<LoadImportResult>) => {
    if (!tenant || !actor) throw new Error('Entre com uma sessão válida e selecione a empresa.');
    if (busy.current) throw new Error('Aguarde a importação em andamento.');
    assertContext(); busy.current = true; setPending(true);
    try { const result = await work(); assertContext(); return result; }
    catch (cause) { throw new Error(loadImportError(cause)); }
    finally {
      try {
        await Promise.all(['load-control','load-documents','load-unloading','load-import-batches']
          .map(key => queryClient.invalidateQueries({ queryKey: [key] })));
      } finally { busy.current = false; if (alive.current) setPending(false); }
    }
  };

  return {
    isPending, pending: recovery.pending, recoveryError: recovery.error,
    submit: (input: LoadImportCommandInput) => run(() => outbox.submit(tenant!, actor!, input)),
    recover: () => run(() => outbox.recover(tenant!, actor!)),
  };
}
