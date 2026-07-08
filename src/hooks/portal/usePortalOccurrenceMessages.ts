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

export function usePortalOccurrenceMessages(occurrenceId: string | null) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['portal_occurrence_messages', currentTenant?.id, occurrenceId],
    queryFn: async (): Promise<PortalOccurrenceMessage[]> => {
      if (!currentTenant || !occurrenceId) return [];
      const { data, error } = await supabase.rpc('list_client_occurrence_messages' as any, {
        _tenant_id: currentTenant.id,
        _occurrence_id: occurrenceId,
      });
      if (error) throw error;
      return (data as PortalOccurrenceMessage[]) || [];
    },
    enabled: !!currentTenant && !!occurrenceId,
  });
}

export function useReplyPortalOccurrence() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { occurrence_id: string; message: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.rpc('reply_client_occurrence' as any, {
        _tenant_id: currentTenant.id,
        _occurrence_id: args.occurrence_id,
        _message: args.message,
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