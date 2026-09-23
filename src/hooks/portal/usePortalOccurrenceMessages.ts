import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export interface PortalOccurrenceMessage {
  id: string;
  author_role: 'client' | 'operator';
  author_name: string;
  message: string;
  created_at: string;
}

const MESSAGE_PAGE_SIZE = 100;

export function mergePortalOccurrenceMessages(
  ...groups: PortalOccurrenceMessage[][]
): PortalOccurrenceMessage[] {
  const byId = new Map<string, PortalOccurrenceMessage>();
  for (const message of groups.flat()) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => (
    left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
  ));
}

async function readMessagePage(args: {
  tenantId: string;
  occurrenceId: string;
  signal: AbortSignal;
  before?: PortalOccurrenceMessage;
}): Promise<PortalOccurrenceMessage[]> {
  const { data, error } = await supabase.rpc('list_client_occurrence_messages_v2', {
    _tenant_id: args.tenantId,
    _occurrence_id: args.occurrenceId,
    _limit: MESSAGE_PAGE_SIZE + 1,
    _before_created_at: args.before?.created_at,
    _before_id: args.before?.id,
  }).abortSignal(args.signal);
  if (error) throw error;
  return (data as PortalOccurrenceMessage[]) || [];
}

export function usePortalOccurrenceMessages(occurrenceId: string | null) {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  const [olderMessages, setOlderMessages] = useState<PortalOccurrenceMessage[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<unknown>(null);
  const olderRequestRef = useRef<{ contextKey: string; controller: AbortController } | null>(null);
  const contextKey = `${currentTenant?.id ?? ''}:${occurrenceId ?? ''}`;
  const query = useQuery({
    queryKey: ['portal_occurrence_messages', currentTenant?.id, occurrenceId],
    queryFn: async ({ signal }): Promise<PortalOccurrenceMessage[]> => {
      if (!currentTenant || !occurrenceId) return [];
      return readMessagePage({ tenantId: currentTenant.id, occurrenceId, signal });
    },
    enabled: !!currentTenant && !!occurrenceId,
    // Fallback de polling (10s) enquanto o diálogo está aberto — Realtime
    // entrega novas mensagens em tempo real quando a policy permite.
    refetchInterval: occurrenceId ? 10000 : false,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    olderRequestRef.current?.controller.abort();
    olderRequestRef.current = null;
    setOlderMessages([]);
    setOlderHasMore(null);
    setIsLoadingOlder(false);
    setOlderError(null);
    return () => {
      const request = olderRequestRef.current;
      if (request?.contextKey === contextKey) {
        request.controller.abort();
        olderRequestRef.current = null;
      }
    };
  }, [contextKey]);

  const latestMessages = (query.data ?? []).slice(0, MESSAGE_PAGE_SIZE);
  useEffect(() => {
    if (!query.data?.length) return;
    const observedWindow = query.data.slice(0, MESSAGE_PAGE_SIZE);
    setOlderMessages((current) => mergePortalOccurrenceMessages(current, observedWindow));
  }, [contextKey, query.data]);
  const messages = useMemo(
    () => mergePortalOccurrenceMessages(latestMessages, olderMessages),
    [latestMessages, olderMessages],
  );

  const hasOlder = olderHasMore ?? (query.data?.length ?? 0) > MESSAGE_PAGE_SIZE;
  const loadOlder = useCallback(async () => {
    if (!currentTenant || !occurrenceId || !hasOlder || isLoadingOlder || olderRequestRef.current) return;
    const oldest = messages[0];
    if (!oldest) return;
    const request = { contextKey, controller: new AbortController() };
    olderRequestRef.current = request;
    setIsLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await readMessagePage({
        tenantId: currentTenant.id,
        occurrenceId,
        before: oldest,
        signal: request.controller.signal,
      });
      if (olderRequestRef.current !== request || request.controller.signal.aborted) return;
      setOlderMessages((current) => mergePortalOccurrenceMessages(current, page.slice(0, MESSAGE_PAGE_SIZE)));
      setOlderHasMore(page.length > MESSAGE_PAGE_SIZE);
    } catch (error) {
      if (olderRequestRef.current !== request || request.controller.signal.aborted) return;
      setOlderError(error);
    } finally {
      if (olderRequestRef.current === request) {
        olderRequestRef.current = null;
        setIsLoadingOlder(false);
      }
    }
  }, [currentTenant, occurrenceId, hasOlder, isLoadingOlder, messages, contextKey]);

  useEffect(() => {
    if (!currentTenant || !occurrenceId) return undefined;
    const channel = supabase
      .channel(`portal_occ_msgs_${occurrenceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'client_occurrence_messages',
          filter: `occurrence_id=eq.${occurrenceId}`,
        },
        () => {
          qc.invalidateQueries({
            queryKey: ['portal_occurrence_messages', currentTenant.id, occurrenceId],
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentTenant, occurrenceId, qc]);

  return {
    ...query,
    data: messages,
    hasOlder,
    loadOlder,
    isLoadingOlder,
    olderError,
  };
}

export function useReplyPortalOccurrence() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { occurrence_id: string; message: string; request_id: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.rpc('reply_client_occurrence_v2', {
        _tenant_id: currentTenant.id,
        _occurrence_id: args.occurrence_id,
        _message: args.message,
        _request_id: args.request_id,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ['portal_occurrence_messages', currentTenant?.id, args.occurrence_id] });
      qc.invalidateQueries({ queryKey: ['portal_occurrences'] });
    },
  });
}
