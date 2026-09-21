import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Json, TablesInsert } from '@/integrations/supabase/types';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';

export const CHECKLIST_TYPES = ['pre_trip', 'post_trip', 'damage', 'equipment', 'tire', 'safety', 'documentation'] as const;
export const CHECKLIST_TYPE_LABELS: Record<string, string> = {
  pre_trip: 'Saída de Veículo', post_trip: 'Retorno', damage: 'Avarias',
  equipment: 'Conferência Equipamento', tire: 'Pneus', safety: 'Segurança', documentation: 'Documentação',
};
export const EXECUTION_STATUSES = ['passed', 'failed', 'partial'] as const;
export const EXECUTION_STATUS_LABELS: Record<string, string> = {
  passed: 'Aprovado', failed: 'Reprovado', partial: 'Parcial',
};

export interface OperationalChecklist {
  id: string; tenant_id: string; name: string; checklist_type: string;
  items: { key: string; label: string; required: boolean }[];
  active: boolean; created_at: string;
  can_block_operation: boolean;
  can_generate_incident: boolean;
  can_generate_maintenance: boolean;
}

export interface ChecklistExecution {
  id: string; tenant_id: string; checklist_id: string;
  vehicle_id: string | null; employee_id: string | null;
  dispatch_trip_id: string | null;
  execution_type: string | null;
  checked_items: { key: string; label: string; required?: boolean; status: 'pending' | 'ok' | 'nok' | 'na'; notes?: string }[];
  status: string; total_items: number; passed_items: number; failed_items: number;
  blocked_operation: boolean; notes: string | null;
  generated_incident_id: string | null; generated_maintenance_id: string | null;
  executed_at: string; executed_by: string | null; created_at: string;
  operational_checklists?: { name: string; checklist_type: string } | null;
  vehicles?: { plate: string } | null;
  employees?: { name: string } | null;
}

export function useOperationalChecklists() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['operational_checklists', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('operational_checklists').select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as unknown as OperationalChecklist[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateChecklist() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<OperationalChecklist>) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const payload = {
        ...values,
        items: (values.items || []) as Json,
        tenant_id: currentTenant.id,
        created_by: user?.id,
      } as unknown as TablesInsert<'operational_checklists'>;
      const { data, error } = await supabase.from('operational_checklists').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operational_checklists'] }),
  });
}

export function useChecklistExecutions(checklistId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['checklist_executions', currentTenant?.id, checklistId],
    queryFn: async () => {
      if (!currentTenant) return [];
      return await fetchAllPostgrestPages((from, to) => {
        let q = supabase
          .from('checklist_executions')
          .select('*, operational_checklists:operational_checklists!checklist_executions_tenant_checklist_fkey(name, checklist_type), vehicles:vehicles!checklist_executions_tenant_vehicle_fkey(plate), employees:employees!checklist_executions_tenant_employee_fkey(name)')
          .eq('tenant_id', currentTenant.id)
          .order('executed_at', { ascending: false })
          .order('id');
        if (checklistId) q = q.eq('checklist_id', checklistId);
        return q.range(from, to);
      }) as unknown as ChecklistExecution[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateChecklistExecution() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<ChecklistExecution>) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const checkedItems = values.checked_items || [];
      if (!values.checklist_id) throw new Error('Checklist não selecionado');
      const { data, error } = await supabase.rpc('create_checklist_execution_v1', {
        _tenant_id: currentTenant.id,
        _checklist_id: values.checklist_id,
        _checked_items: checkedItems as Json,
        _vehicle_id: values.vehicle_id || undefined,
        _employee_id: values.employee_id || undefined,
        _dispatch_trip_id: values.dispatch_trip_id || undefined,
        _notes: values.notes || undefined,
      });
      if (error) throw error;
      return data as unknown as ChecklistExecution;
    },
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ['checklist_executions'] }),
      qc.invalidateQueries({ queryKey: ['incidents'] }),
      qc.invalidateQueries({ queryKey: ['maintenance_orders'] }),
    ]),
  });
}
