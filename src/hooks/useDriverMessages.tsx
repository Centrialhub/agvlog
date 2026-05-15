import { useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export interface DriverMessage {
  id: string;
  tenant_id: string;
  driver_id: string;
  sender_id: string | null;
  sender_role: string;
  sender_name: string | null;
  message: string;
  attachment_url: string | null;
  created_at: string;
}

export function useDriverMessages(driverId: string | null | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['driver_messages', driverId],
    queryFn: async () => {
      if (!driverId) return [];
      const { data, error } = await (supabase as any)
        .from('driver_direct_messages')
        .select('*')
        .eq('driver_id', driverId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as DriverMessage[];
    },
    enabled: !!driverId,
  });

  useEffect(() => {
    if (!driverId) return;
    const channel = supabase
      .channel(`driver_msg_${driverId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'driver_direct_messages', filter: `driver_id=eq.${driverId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['driver_messages', driverId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [driverId, qc]);

  return query;
}

export function useSendDriverMessage() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ driverId, message, role, name }: { driverId: string; message: string; role?: string; name?: string }) => {
      const { error } = await (supabase as any).from('driver_direct_messages').insert({
        tenant_id: currentTenant!.id,
        driver_id: driverId,
        sender_id: user?.id || null,
        sender_role: role || 'operator',
        sender_name: name || user?.email || null,
        message,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['driver_messages', vars.driverId] });
    },
  });
}