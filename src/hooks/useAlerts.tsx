import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';

export interface AlertRule {
  id: string;
  tenant_id: string;
  rule_type: string;
  enabled: boolean;
  params: any;
  created_at: string;
}

export interface AlertInstance {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  rule_id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'ack' | 'closed';
  details: any;
  captured_at: string;
  closed_at: string | null;
  vehicles?: {
    plate: string;
    nickname: string | null;
  } | null;
  alert_rules?: {
    rule_type: string;
    params: any;
  } | null;
}

export const useAlertRules = () => {
  const { currentTenant } = useTenant();

  return useQuery<AlertRule[]>({
    queryKey: ['alert_rules', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('alert_rules')
        .select('*')
        .eq('tenant_id', currentTenant.id);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant
  });
};

export const useAlertInstances = (filters: { status?: string[] } = {}) => {
  const { currentTenant } = useTenant();

  return useQuery<AlertInstance[]>({
    queryKey: ['alert_instances', currentTenant?.id, filters],
    queryFn: async () => {
      if (!currentTenant) return [];
      let query = supabase
        .from('alert_instances')
        .select('*, vehicles(plate, nickname), alert_rules(rule_type, params)')
        .eq('tenant_id', currentTenant.id);
      
      if (filters.status && filters.status.length > 0) {
        query = query.in('status', filters.status);
      }

      const { data, error } = await query.order('captured_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant
  });
};

export const useUpdateAlertInstance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string, status: 'ack' | 'closed' }) => {
      const update: any = { status };
      if (status === 'closed') update.closed_at = new Date().toISOString();
      
      const { error } = await supabase
        .from('alert_instances')
        .update(update)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert_instances'] });
    }
  });
};
