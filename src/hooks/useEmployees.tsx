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

export function useEmployees() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['employees', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await (supabase as any)
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
    mutationFn: async (values: Partial<Employee>) => {
      const { data, error } = await (supabase as any).from('employees').insert({
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
    mutationFn: async ({ id, ...values }: Partial<Employee> & { id: string }) => {
      const { data, error } = await (supabase as any).from('employees')
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
      const { data, error } = await (supabase as any)
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
    mutationFn: async (values: Partial<EmployeeDocument>) => {
      const { data, error } = await (supabase as any).from('employee_documents').insert({
        ...values, tenant_id: currentTenant!.id, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee_documents'] }),
  });
}
