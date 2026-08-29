import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export const EMPLOYEE_STATUSES = ['active', 'inactive', 'on_leave', 'terminated'] as const;
export type EmployeeStatus = typeof EMPLOYEE_STATUSES[number];
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'Ativo', inactive: 'Inativo', on_leave: 'Afastado', terminated: 'Desligado',
};

export type Employee = Omit<Tables<'employees'>, 'status'> & { status: EmployeeStatus };
export type EmployeeDocument = Tables<'employee_documents'>;
export type CreateEmployeeInput = Omit<TablesInsert<'employees'>, 'tenant_id' | 'created_by'>;
export type UpdateEmployeeInput = TablesUpdate<'employees'> & { id: string };
export type CreateEmployeeDocumentInput = Omit<TablesInsert<'employee_documents'>, 'tenant_id' | 'created_by'>;

export function useEmployees() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['employees', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('employees').select('*')
        .eq('tenant_id', currentTenant.id)
        .order('name');
      if (error) throw error;
      return (data || []) as Employee[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateEmployee() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateEmployeeInput) => {
      const { data, error } = await supabase.from('employees').insert({
        ...values, tenant_id: currentTenant!.id, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: UpdateEmployeeInput) => {
      const { data, error } = await supabase.from('employees')
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });
}

export function useEmployeeDocuments(employeeId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['employee_documents', employeeId],
    queryFn: async () => {
      if (!currentTenant || !employeeId) return [];
      const { data, error } = await supabase
        .from('employee_documents').select('*')
        .eq('employee_id', employeeId)
        .order('expiry_date', { ascending: true });
      if (error) throw error;
      return (data || []) as EmployeeDocument[];
    },
    enabled: !!currentTenant && !!employeeId,
  });
}

export function useCreateEmployeeDocument() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateEmployeeDocumentInput) => {
      const { data, error } = await supabase.from('employee_documents').insert({
        ...values, tenant_id: currentTenant!.id, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee_documents'] }),
  });
}
