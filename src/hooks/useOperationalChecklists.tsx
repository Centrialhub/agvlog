import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

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
}

export interface ChecklistExecution {
  id: string; tenant_id: string; checklist_id: string;
  vehicle_id: string | null; employee_id: string | null;
  dispatch_trip_id: string | null;
  execution_type: string | null;
  checked_items: { key: string; label: string; status: 'ok' | 'nok' | 'na'; notes?: string }[];
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
      const { data, error } = await (supabase as any)
        .from('operational_checklists').select('*')
        .eq('tenant_id', currentTenant.id).order('name');
      if (error) throw error;
      return (data || []) as OperationalChecklist[];
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
      const { data, error } = await (supabase as any).from('operational_checklists').insert({
        ...values, tenant_id: currentTenant!.id, created_by: user?.id,
      }).select().single();
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
      let q = (supabase as any)
        .from('checklist_executions')
        .select('*, operational_checklists(name, checklist_type), vehicles(plate), employees(name)')
        .eq('tenant_id', currentTenant.id)
        .order('executed_at', { ascending: false })
        .limit(200);
      if (checklistId) q = q.eq('checklist_id', checklistId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as ChecklistExecution[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateChecklistExecution() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<ChecklistExecution>) => {
      const checkedItems = values.checked_items || [];
      const passed = checkedItems.filter(i => i.status === 'ok').length;
      const failed = checkedItems.filter(i => i.status === 'nok').length;
      const total = checkedItems.length;
      const status = failed === 0 ? 'passed' : passed === 0 ? 'failed' : 'partial';
      const { data, error } = await (supabase as any).from('checklist_executions').insert({
        ...values,
        tenant_id: currentTenant!.id,
        executed_by: user?.id,
        total_items: total,
        passed_items: passed,
        failed_items: failed,
        status,
        blocked_operation: values.blocked_operation ?? (failed > 0),
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklist_executions'] }),
  });
}
