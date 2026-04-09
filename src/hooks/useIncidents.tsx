import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export const INCIDENT_TYPES = ['accident','damage','loss','delay','complaint','violation','theft','other'] as const;
export const INCIDENT_CATEGORIES = ['operational','fleet','hr','safety','customer'] as const;
export const INCIDENT_SEVERITIES = ['low','medium','high','critical'] as const;
export const INCIDENT_STATUSES = ['open','investigating','action_plan','resolved','closed','cancelled'] as const;
export const RESPONSIBILITY_TYPES = ['operational','patrimonial','financial','disciplinary'] as const;

export const INCIDENT_TYPE_LABELS: Record<string,string> = {
  accident:'Acidente', damage:'Avaria', loss:'Extravio', delay:'Atraso',
  complaint:'Reclamação', violation:'Infração', theft:'Furto/Roubo', other:'Outro',
};
export const INCIDENT_STATUS_LABELS: Record<string,string> = {
  open:'Aberta', investigating:'Investigando', action_plan:'Plano de Ação',
  resolved:'Resolvida', closed:'Encerrada', cancelled:'Cancelada',
};
export const SEVERITY_LABELS: Record<string,string> = { low:'Baixa', medium:'Média', high:'Alta', critical:'Crítica' };
export const RESPONSIBILITY_LABELS: Record<string,string> = {
  operational:'Operacional', patrimonial:'Patrimonial', financial:'Financeira', disciplinary:'Disciplinar',
};

export interface Incident {
  id: string; tenant_id: string; incident_number: string;
  incident_type: string; category: string | null; severity: string; status: string;
  title: string; description: string | null;
  occurred_at: string; reported_at: string;
  sla_deadline: string | null; resolved_at: string | null; closed_at: string | null;
  load_id: string | null; order_id: string | null; vehicle_id: string | null;
  employee_id: string | null; driver_id: string | null; client_id: string | null;
  asset_id: string | null; route_id: string | null;
  probable_cause: string | null; root_cause: string | null;
  action_plan: string | null; conclusion: string | null;
  estimated_cost: number; actual_cost: number;
  opened_by: string | null; validated_by: string | null;
  created_at: string; updated_at: string;
  employees?: { name: string } | null;
  clients?: { company_name: string } | null;
}

export interface IncidentResponsible {
  id: string; tenant_id: string; incident_id: string;
  employee_id: string | null; responsibility_type: string;
  description: string | null; acknowledged: boolean;
  final_opinion: string | null; cost_assigned: number;
  employees?: { name: string } | null;
}

export function useIncidents() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['incidents', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await (supabase as any)
        .from('incidents').select('*, employees(name), clients(company_name)')
        .eq('tenant_id', currentTenant.id)
        .order('occurred_at', { ascending: false });
      if (error) throw error;
      return (data || []) as Incident[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateIncident() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Incident>) => {
      const num = `INC-${Date.now().toString(36).toUpperCase()}`;
      const { data, error } = await (supabase as any).from('incidents').insert({
        ...values, tenant_id: currentTenant!.id, incident_number: num,
        opened_by: user?.id, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incidents'] }),
  });
}

export function useUpdateIncident() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<Incident> & { id: string }) => {
      const { data, error } = await (supabase as any).from('incidents')
        .update({ ...values, updated_by: user?.id, updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incidents'] }),
  });
}

export function useIncidentResponsibles(incidentId?: string) {
  return useQuery({
    queryKey: ['incident_responsible', incidentId],
    queryFn: async () => {
      if (!incidentId) return [];
      const { data, error } = await (supabase as any)
        .from('incident_responsible').select('*, employees(name)')
        .eq('incident_id', incidentId);
      if (error) throw error;
      return (data || []) as IncidentResponsible[];
    },
    enabled: !!incidentId,
  });
}

export function useAddIncidentResponsible() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<IncidentResponsible>) => {
      const { data, error } = await (supabase as any).from('incident_responsible').insert({
        ...values, tenant_id: currentTenant!.id, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incident_responsible'] }),
  });
}
