import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { MEMBERSHIP_QUERY } from '@/components/auth/TenantDataBoundary';
import { useTenant } from '@/hooks/useTenant';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import type { CompanyProfile } from '@/hooks/useCompanyProfile';
import type { Json } from '@/integrations/supabase/types';

const emitterSchema = z.object({
  id: z.string().uuid(),
  cnpj: z.string(),
  razao_social: z.string(),
  nome_fantasia: z.string().nullable(),
  branch_code: z.string(),
  active: z.boolean(),
  is_default: z.boolean(),
});

const companySchema = z.object({
  legal_name: z.string().optional(), trade_name: z.string().optional(), tax_id: z.string().optional(),
  state_registration: z.string().optional(), address: z.string().optional(), city: z.string().optional(),
  state: z.string().optional(), zip: z.string().optional(), phone: z.string().optional(),
  email: z.string().optional(), website: z.string().optional(), logo_data_url: z.string().optional(),
}).passthrough();

const workspaceTenantSchema = z.object({
  id: z.string().uuid(), workspace_id: z.string().uuid(), name: z.string(), plan_key: z.string(),
  timezone: z.string(), company: companySchema, emitters: z.array(emitterSchema),
});

export type WorkspaceTenant = z.infer<typeof workspaceTenantSchema>;
export type WorkspaceTenantEmitter = z.infer<typeof emitterSchema>;

export interface InitialFiscalEmitter {
  cnpj: string;
  razao_social: string;
  nome_fantasia?: string;
  branch_code?: string;
  ie?: string;
  im?: string;
  regime_tributario?: string;
  city_code?: string;
}

export interface WorkspaceTenantInput {
  name: string;
  timezone?: string;
  company: CompanyProfile;
  initial_emitter?: InitialFiscalEmitter | null;
}

function errorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (error.message.includes('company_tax_id_already_registered')) return 'Este CNPJ já está cadastrado em outra empresa do grupo.';
  if (error.message.includes('workspace_admin_required')) return 'Somente administradores do grupo podem gerenciar empresas.';
  return error.message || fallback;
}

export function useWorkspaceTenants(enabled = true) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['workspace_tenants', currentTenant?.id],
    enabled: enabled && !!currentTenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_workspace_tenants_v1', { _tenant_id: currentTenant!.id });
      if (error) throw error;
      return z.array(workspaceTenantSchema).parse(data);
    },
  });
}

export function useCreateWorkspaceTenant() {
  const { currentTenant } = useTenant();
  const queryClient = useQueryClient();
  const toast = useSonnerToast();
  return useMutation({
    mutationFn: async (input: WorkspaceTenantInput) => {
      if (!currentTenant?.id) throw new Error('Selecione uma empresa ativa.');
      const { data, error } = await supabase.rpc('create_workspace_tenant_v1', {
        _tenant_id: currentTenant.id,
        _name: input.name,
        _company: input.company as Json,
        _timezone: input.timezone || 'America/Sao_Paulo',
        _initial_emitter: (input.initial_emitter || undefined) as Json | undefined,
      });
      if (error) throw error;
      return z.object({ tenant_id: z.string().uuid(), default_emitter_id: z.string().uuid().nullable() }).parse(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace_tenants'] });
      queryClient.invalidateQueries({ queryKey: [MEMBERSHIP_QUERY] });
      toast.success('Empresa cadastrada no grupo');
    },
    onError: (error) => toast.error(errorMessage(error, 'Falha ao cadastrar empresa')),
  });
}

export function useUpdateWorkspaceTenant() {
  const { currentTenant } = useTenant();
  const queryClient = useQueryClient();
  const toast = useSonnerToast();
  return useMutation({
    mutationFn: async (input: WorkspaceTenantInput & { id: string }) => {
      if (!currentTenant?.id) throw new Error('Selecione uma empresa ativa.');
      const { error } = await supabase.rpc('update_workspace_tenant_v1', {
        _tenant_id: currentTenant.id,
        _target_tenant_id: input.id,
        _name: input.name,
        _company: input.company as Json,
        _timezone: input.timezone || 'America/Sao_Paulo',
      });
      if (error) throw error;
      return input.id;
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['workspace_tenants'] });
      queryClient.invalidateQueries({ queryKey: ['company_profile', input.id] });
      queryClient.invalidateQueries({ queryKey: [MEMBERSHIP_QUERY] });
      toast.success('Cadastro da empresa atualizado');
    },
    onError: (error) => toast.error(errorMessage(error, 'Falha ao atualizar empresa')),
  });
}

export function useSetWorkspaceTenantDefaultEmitter() {
  const { currentTenant } = useTenant();
  const queryClient = useQueryClient();
  const toast = useSonnerToast();
  return useMutation({
    mutationFn: async ({ tenantId, emitterId }: { tenantId: string; emitterId: string }) => {
      if (!currentTenant?.id) throw new Error('Selecione uma empresa ativa.');
      const { error } = await supabase.rpc('set_workspace_tenant_default_emitter_v1', {
        _tenant_id: currentTenant.id, _target_tenant_id: tenantId, _emitter_id: emitterId,
      });
      if (error) throw error;
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['workspace_tenants'] });
      queryClient.invalidateQueries({ queryKey: ['tenant_emitters', input.tenantId] });
      toast.success('Emitente fiscal padrão atualizado');
    },
    onError: (error) => toast.error(errorMessage(error, 'Falha ao definir emitente fiscal')),
  });
}
