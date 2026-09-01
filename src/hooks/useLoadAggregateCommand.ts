import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { supabase } from '@/integrations/supabase/client';
import {
  loadAggregateError, type LoadAggregateCommandInput, type LoadAggregateResult,
} from '@/lib/loads/loadAggregateCommands';
import {
  createLoadAggregateOutbox, LOAD_AGGREGATE_COMMAND_CHANGED, pendingLoadAggregateCommand,
} from '@/lib/loads/loadAggregateOutbox';

export function useLoadAggregateCommand() {
  const queryClient = useQueryClient();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const tenant = currentTenant?.id;
  const actor = user?.id;
  const latest = useRef({ tenant, actor }); latest.current = { tenant, actor };
  const alive = useRef(true);
  const busy = useRef(false);
  const [isPending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    alive.current = true;
    const changed = () => setRevision(value => value + 1);
    window.addEventListener('storage', changed);
    window.addEventListener(LOAD_AGGREGATE_COMMAND_CHANGED, changed);
    return () => {
      alive.current = false;
      window.removeEventListener('storage', changed);
      window.removeEventListener(LOAD_AGGREGATE_COMMAND_CHANGED, changed);
    };
  }, []);

  const assertContext = useCallback(() => {
    if (!alive.current || latest.current.actor !== actor || latest.current.tenant !== tenant) {
      throw new Error('A sessão ou empresa mudou. Recupere a alteração na sessão original.');
    }
  }, [actor, tenant]);

  const outbox = useMemo(() => createLoadAggregateOutbox({
    get storage() { return window.localStorage; },
    uuid: () => crypto.randomUUID(),
    assertContext,
    changed: () => window.dispatchEvent(new Event(LOAD_AGGREGATE_COMMAND_CHANGED)),
    lock: async (key, work) => {
      if (!navigator.locks) throw new Error('Use um navegador atualizado em conexão segura para alterar cargas.');
      return navigator.locks.request(key, work);
    },
    send: async payload => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        return await supabase.rpc('apply_load_aggregate_command', {
          _payload: JSON.parse(JSON.stringify(payload)),
        }).abortSignal(controller.signal);
      } finally { clearTimeout(timeout); }
    },
  }), [assertContext]);

  const recovery = useMemo(() => {
    try {
      return {
        revision,
        pending: tenant && actor ? pendingLoadAggregateCommand(window.localStorage, tenant, actor) : null,
        error: null,
      };
    } catch (cause) {
      return { revision, pending: null, error: loadAggregateError(cause) };
    }
  }, [actor, revision, tenant]);

  const run = async (work: () => Promise<LoadAggregateResult>) => {
    if (!tenant || !actor) throw new Error('Entre com uma sessão válida e selecione a empresa.');
    if (busy.current) throw new Error('Aguarde a alteração de carga em andamento.');
    assertContext(); busy.current = true; setPending(true);
    try { const result = await work(); assertContext(); return result; }
    catch (cause) { throw new Error(loadAggregateError(cause)); }
    finally {
      try {
        await Promise.all([
          ['loads'], ['pending_loads_for_routing'], ['load'], ['romaneio'], ['dispatch-trips'],
        ].map(queryKey => queryClient.invalidateQueries({ queryKey })));
      } finally {
        busy.current = false;
        if (alive.current) setPending(false);
      }
    }
  };

  return {
    isPending,
    pending: recovery.pending,
    recoveryError: recovery.error,
    submit: (input: LoadAggregateCommandInput) => run(() => outbox.submit(tenant!, actor!, input)),
    recover: () => run(() => outbox.recover(tenant!, actor!)),
  };
}
