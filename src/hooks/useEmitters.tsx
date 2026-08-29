import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { HUB_FISCAL_CREDENTIAL_SAFE_SELECT } from '@/integrations/supabase/selects';
import type { Json, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import { useTenant } from './useTenant';
import { toast } from '@/components/ui/sonner';
import { selectDefaultActiveEmitter } from '@/lib/fiscal/emitterSelection';

export interface TenantEmitterAddress {
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  cep?: string | null;
  rntrc?: string | null;
  telefone?: string | null;
  email?: string | null;
}

export interface TenantEmitter {
  id: string;
  tenant_id: string;
  branch_code: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  ie: string | null;
  im: string | null;
  regime_tributario: string | null;
  rntrc?: string | null;
  city_code: string | null;
  endereco: TenantEmitterAddress;
  logo_url: string | null;
  is_default: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type HubFiscalDocumentScope = 'all' | 'nfse' | 'cte' | 'nfe' | 'nfce' | 'mdfe' | 'nfcom';
export type HubFiscalEnvironment = 'sandbox' | 'homologation' | 'production';

export interface HubFiscalCredential {
  id: string;
  tenant_id: string;
  emitter_id: string;
  doc_scope: HubFiscalDocumentScope;
  environment: HubFiscalEnvironment;
  secret_name: string | null;
  secret_hint?: string | null;
  has_ciphertext?: boolean;
  enabled: boolean;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

const HUB_FISCAL_DOCUMENT_SCOPES: readonly HubFiscalDocumentScope[] = [
  'all',
  'nfse',
  'cte',
  'nfe',
  'nfce',
  'mdfe',
  'nfcom',
];

function toDocumentScope(value: string): HubFiscalDocumentScope {
  return HUB_FISCAL_DOCUMENT_SCOPES.includes(value as HubFiscalDocumentScope)
    ? (value as HubFiscalDocumentScope)
    : 'all';
}

function toEnvironment(value: string): HubFiscalEnvironment {
  if (value === 'production' || value === 'homologation') return value;
  return 'sandbox';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useEmitters() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['tenant_emitters', currentTenant?.id],
    enabled: !!currentTenant,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenant_emitters')
        .select('*')
        .eq('tenant_id', currentTenant!.id)
        .order('is_default', { ascending: false })
        .order('branch_code', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((emitter) => ({
        ...emitter,
        endereco: (emitter.endereco ?? {}) as TenantEmitterAddress,
      })) as TenantEmitter[];
    },
  });
}

export function useDefaultEmitter() {
  const q = useEmitters();
  return { ...q, data: selectDefaultActiveEmitter(q.data ?? []) };
}

export function useSaveEmitter() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<TenantEmitter> & { id?: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const payload = { ...input, tenant_id: currentTenant.id };
      if (payload.cnpj) payload.cnpj = String(payload.cnpj).replace(/\D/g, '');
      if (input.id) {
        const { id: _id, ...patch } = payload;
        const { data, error } = await supabase
          .from('tenant_emitters')
          .update(patch as TablesUpdate<'tenant_emitters'>)
          .eq('id', input.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from('tenant_emitters')
        .insert(payload as TablesInsert<'tenant_emitters'>)
        .select()
        .single();
      if (error) {
        if (error.code === '23505') {
          throw new Error('Já existe um emitente com este CNPJ neste tenant. Edite o emitente existente na lista.');
        }
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant_emitters'] });
      toast.success('Emitente salvo');
    },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Falha ao salvar emitente')),
  });
}

export function useDeleteEmitter() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { error } = await supabase.from('tenant_emitters').delete()
        .eq('id', id)
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant_emitters'] });
      toast.success('Emitente removido');
    },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Falha ao remover')),
  });
}

export function useMakeDefaultEmitter() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { error } = await supabase.rpc('set_default_tenant_emitter', {
        _tenant_id: currentTenant.id,
        _emitter_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant_emitters'] });
      toast.success('Emitente padrão atualizado');
    },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Falha ao definir emitente padrão')),
  });
}

export function useHubCredentials(emitterId?: string | null) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['hub_fiscal_credentials', currentTenant?.id, emitterId],
    enabled: !!currentTenant && !!emitterId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hub_fiscal_credentials')
        .select(HUB_FISCAL_CREDENTIAL_SAFE_SELECT)
        .eq('emitter_id', emitterId!)
        .eq('tenant_id', currentTenant!.id)
        .order('doc_scope');
      if (error) throw error;
      return (data ?? []).map((credential) => ({
        ...credential,
        doc_scope: toDocumentScope(credential.doc_scope),
        environment: toEnvironment(credential.environment),
        metadata: credential.metadata,
        has_ciphertext: Boolean(credential.secret_hint || credential.secret_name),
      })) as HubFiscalCredential[];
    },
  });
}

export function useSaveHubCredential() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<HubFiscalCredential> & { id?: string; emitter_id: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const payload = { ...input, tenant_id: currentTenant.id };
      if (input.id) {
        const { id: _id, ...patch } = payload;
        const { data, error } = await supabase
          .from('hub_fiscal_credentials')
          .update(patch as TablesUpdate<'hub_fiscal_credentials'>)
          .eq('id', input.id)
          .select(HUB_FISCAL_CREDENTIAL_SAFE_SELECT)
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from('hub_fiscal_credentials')
        .insert(payload as TablesInsert<'hub_fiscal_credentials'>)
        .select(HUB_FISCAL_CREDENTIAL_SAFE_SELECT)
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hub_fiscal_credentials'] });
      toast.success('Credencial salva');
    },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Falha ao salvar credencial')),
  });
}

export function useSaveHubCredentialToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      emitter_id: string;
      doc_scope: HubFiscalCredential['doc_scope'];
      environment: HubFiscalCredential['environment'];
      enabled?: boolean;
      token: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('hub-fiscal-credential-save', { body: input });
      if (error) throw new Error(error.message || 'Falha ao salvar token');
      const response = data as { error?: unknown } | null;
      if (typeof response?.error === 'string' && response.error) throw new Error(response.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hub_fiscal_credentials'] });
      toast.success('Token do Hub Fiscal salvo com segurança');
    },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Falha ao salvar token')),
  });
}

export function useDeleteHubCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, emitter_id }: { id: string; emitter_id: string }) => {
      const { error } = await supabase.from('hub_fiscal_credentials').delete().eq('id', id);
      if (error) throw error;
      return emitter_id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hub_fiscal_credentials'] }),
  });
}
