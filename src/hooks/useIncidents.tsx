import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

type IncidentRow = Database['public']['Tables']['incidents']['Row'];
type IncidentInsert = Database['public']['Tables']['incidents']['Insert'];
type IncidentUpdate = Database['public']['Tables']['incidents']['Update'];
type IncidentResponsibleRow = Database['public']['Tables']['incident_responsible']['Row'];
type IncidentResponsibleInsert = Database['public']['Tables']['incident_responsible']['Insert'];
type EmployeeIncidentActionRow = Database['public']['Tables']['employee_incident_actions']['Row'];

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

export const INCIDENT_CATEGORY_LABELS: Record<string,string> = {
  operational: 'Operacional',
  fleet: 'Frota',
  hr: 'RH',
  safety: 'Segurança',
  customer: 'Cliente',
};

export const INCIDENT_ACTION_TYPES = [
  'note','verbal_warning','written_warning','suspension',
  'training_required','payroll_discount','document_request',
  'termination_recommendation','other',
] as const;

export const INCIDENT_ACTION_LABELS: Record<string,string> = {
  note: 'Anotação',
  verbal_warning: 'Advertência verbal',
  written_warning: 'Advertência escrita',
  suspension: 'Suspensão',
  training_required: 'Treinamento requerido',
  payroll_discount: 'Desconto em folha',
  document_request: 'Solicitação de documento',
  termination_recommendation: 'Recomendação de desligamento',
  other: 'Outra',
};

export type Incident = IncidentRow & {
  employees?: { name: string } | null;
  clients?: { company_name: string } | null;
};

export type CreateIncidentInput = Omit<
  IncidentInsert,
  'tenant_id' | 'incident_number' | 'opened_by' | 'created_by'
>;

export type UpdateIncidentInput = Omit<
  IncidentUpdate,
  'id' | 'tenant_id' | 'updated_by' | 'updated_at'
> & { id: string };

export type IncidentResponsible = IncidentResponsibleRow & {
  employees?: { name: string } | null;
};

export type AddIncidentResponsibleInput = Omit<
  IncidentResponsibleInsert,
  'tenant_id' | 'created_by'
>;

export function useIncidents() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['incidents', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
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
    mutationFn: async (values: CreateIncidentInput) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const num = `INC-${Date.now().toString(36).toUpperCase()}`;
      const payload: IncidentInsert = {
        ...values,
        tenant_id: currentTenant.id,
        incident_number: num,
        opened_by: user?.id ?? null,
        created_by: user?.id ?? null,
      };
      const { data, error } = await supabase.from('incidents').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incidents'] }),
  });
}

export function useUpdateIncident() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: UpdateIncidentInput) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const payload: IncidentUpdate = {
        ...values,
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase.from('incidents')
        .update(payload)
        .eq('id', id)
        .eq('tenant_id', currentTenant.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incidents'] }),
  });
}

export function useIncidentResponsibles(incidentId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['incident_responsible', incidentId],
    queryFn: async () => {
      if (!incidentId || !currentTenant) return [];
      const { data, error } = await supabase
        .from('incident_responsible').select('*, employees(name)')
        .eq('incident_id', incidentId)
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
      return (data || []) as IncidentResponsible[];
    },
    enabled: !!incidentId && !!currentTenant,
  });
}

export function useAddIncidentResponsible() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: AddIncidentResponsibleInput) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const payload: IncidentResponsibleInsert = {
        ...values,
        tenant_id: currentTenant.id,
        created_by: user?.id ?? null,
      };
      const { data, error } = await supabase.from('incident_responsible').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incident_responsible'] }),
  });
}

export type EmployeeIncidentAction = EmployeeIncidentActionRow & {
  employees?: { name: string } | null;
};

export function useIncidentActions(incidentId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['employee_incident_actions', incidentId],
    queryFn: async () => {
      if (!incidentId || !currentTenant) return [];
      const { data, error } = await supabase
        .from('employee_incident_actions')
        .select('*, employees(name)')
        .eq('incident_id', incidentId)
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as EmployeeIncidentAction[];
    },
    enabled: !!incidentId && !!currentTenant,
  });
}

export interface AddIncidentActionInput {
  incident_id: string;
  employee_id: string;
  action_type: string;
  description?: string | null;
  amount?: number;
  effective_date?: string | null;
}

export function useAddEmployeeIncidentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: AddIncidentActionInput) => {
      const { data, error } = await supabase.rpc('add_employee_incident_action', {
        _incident_id: values.incident_id,
        _employee_id: values.employee_id,
        _action_type: values.action_type,
        _description: values.description ?? undefined,
        _amount: values.amount ?? 0,
        _effective_date: values.effective_date ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['employee_incident_actions', vars.incident_id] });
      qc.invalidateQueries({ queryKey: ['employee_incident_actions'] });
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['payroll_entries'] });
    },
  });
}
