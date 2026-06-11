import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export interface PortalOccurrence {
  id: string;
  load_id: string | null;
  order_id: string | null;
  event_type: string;
  severity: string;
  description: string | null;
  public_status: string | null;
  client_action_required: boolean;
  client_opened: boolean;
  client_resolution_note: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
}

export function usePortalOccurrences(filters?: { severity?: string; resolved?: boolean }) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['portal_occurrences', currentTenant?.id, filters],
    queryFn: async (): Promise<PortalOccurrence[]> => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.rpc('list_client_occurrences', {
        _tenant_id: currentTenant.id,
        _severity: filters?.severity || null,
        _resolved: filters?.resolved ?? null,
        _limit: 200,
        _offset: 0,
      });
      if (error) throw error;
      return (data as any[]) as PortalOccurrence[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreatePortalOccurrence() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      client_id: string;
      event_type: string;
      description: string;
      severity?: string;
      load_id?: string;
      order_id?: string;
    }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.rpc('create_client_occurrence', {
        _tenant_id: currentTenant.id,
        _client_id: args.client_id,
        _event_type: args.event_type,
        _description: args.description,
        _severity: args.severity || 'medium',
        _load_id: args.load_id || null,
        _order_id: args.order_id || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal_occurrences'] }),
  });
}