import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export const EMPLOYEE_STATUSES = ['active', 'inactive', 'on_leave', 'terminated'] as const;
export type EmployeeStatus = typeof EMPLOYEE_STATUSES[number];
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'Ativo', inactive: 'Inativo', on_leave: 'Afastado', terminated: 'Desligado',
};

export interface Employee {
  id: string;
  tenant_id: string;
  name: string;
  doc_cpf: string | null;
  doc_rg: string | null;
  role_title: string | null;
  department: string | null;
  branch: string | null;
  manager_id: string | null;
  cost_center: string | null;
  hire_date: string | null;
  termination_date: string | null;
  status: EmployeeStatus;
  phone: string | null;
  email: string | null;
  cnh_number: string | null;
  cnh_category: string | null;
  cnh_expiry: string | null;
  medical_exam_expiry: string | null;
  driver_id: string | null;
  user_id: string | null;
  notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface EmployeeDocument {
  id: string;
  tenant_id: string;
  employee_id: string;
  document_type: string;
  document_name: string;
  document_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  status: string;
  attachment_url: string | null;
  notes: string | null;
  created_at: string;
}

export interface PaginatedEmployees {
  items: Employee[];
  next_cursor: string | null;
  total_count: number;
}

export function useEmployees(filters: { search?: string } = {}) {
  const { currentTenant } = useTenant();
  return useQuery<PaginatedEmployees>({
    queryKey: ['employees', currentTenant?.id, filters],
    queryFn: async () => {
      if (!currentTenant) return { items: [], next_cursor: null, total_count: 0 };
      const { data, error } = await supabase.rpc('list_employees_v1', {
        p_tenant_id: currentTenant.id,
        p_search: filters.search || null,
        p_limit: 1000,
      });
      if (error) throw error;
      const result = data as any;
      return {
        items: (result.items || []) as Employee[],
        next_cursor: result.next_cursor || null,
        total_count: Number(result.total_count) || 0,
      };
    },
    enabled: !!currentTenant,

  });
}

export function useEmployeesArray() {
  const q = useEmployees();
  return { ...q, data: q.data?.items ?? [] };
}

export function useCreateEmployee() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Employee>) => {
      const { data, error } = await supabase.rpc('create_employee_v1', {
        p_tenant_id: currentTenant!.id,
        p_values: values,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });
}

export function useUpdateEmployee() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version, ...values }: Partial<Employee> & { id: string; version?: number }) => {
      const { error } = await supabase.rpc('update_employee_v1', {
        p_tenant_id: currentTenant!.id,
        p_employee_id: id,
        p_values: values,
        p_expected_version: version,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });
}

export function useDeleteEmployee() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('delete_employee_v1', {
        p_tenant_id: currentTenant!.id,
        p_employee_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });
}
