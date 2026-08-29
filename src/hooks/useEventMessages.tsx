import { useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export interface EventMessage {
  id: string;
  tenant_id: string;
  event_id: string;
  sender_id: string | null;
  sender_role: string;
  sender_name: string | null;
  message: string;
  attachment_url: string | null;
  created_at: string;
}

export function useEventMessages(eventId: string | null | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['event_messages', eventId],
    queryFn: async () => {
      if (!eventId) return [];
      const { data, error } = await supabase
        .from('operational_event_messages')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as EventMessage[];
    },
    enabled: !!eventId,
  });

  // Realtime subscription
  useEffect(() => {
    if (!eventId) return undefined;
    const channel = supabase
      .channel(`event_msg_${eventId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'operational_event_messages', filter: `event_id=eq.${eventId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['event_messages', eventId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, qc]);

  return query;
}

export function useSendEventMessage() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId, message, role, name }: { eventId: string; message: string; role?: string; name?: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { error } = await supabase.from('operational_event_messages').insert({
        tenant_id: currentTenant.id,
        event_id: eventId,
        sender_id: user?.id || null,
        sender_role: role || 'operator',
        sender_name: name || user?.email || null,
        message,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['event_messages', vars.eventId] });
    },
  });
}
