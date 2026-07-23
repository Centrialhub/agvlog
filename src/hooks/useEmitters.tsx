import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { toast } from 'sonner';

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
  city_code: string | null;
  endereco: Record<string, any>;
  logo_url: string | null;
  is_default: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HubFiscalCredential {
  id: string;
  tenant_id: string;
  emitter_id: string;
  doc_scope: 'all' | 'nfse' | 'cte' | 'nfe' | 'nfce' | 'mdfe';
  environment: 'sandbox' | 'production';
  secret_name: string | null;
  secret_hint?: string | null;
  has_ciphertext?: boolean;
  enabled: boolean;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export function useEmitters() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['tenant_emitters', currentTenant?.id],
    enabled: !!currentTenant,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('tenant_emitters')
        .select('*')
        .eq('tenant_id', currentTenant!.id)
        .order('is_default', { ascending: false })
        .order('branch_code', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TenantEmitter[];
    },
  });
}

export function useDefaultEmitter() {
  const q = useEmitters();
  return { ...q, data: q.data?.find(e => e.is_default && e.active) ?? q.data?.[0] ?? null };
}

export function useSaveEmitter() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<TenantEmitter> & { id?: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const payload: any = { ...input, tenant_id: currentTenant.id };
      if (payload.cnpj) payload.cnpj = String(payload.cnpj).replace(/\D/g, '');
      if (input.id) {
        const { id, ...patch } = payload;
        const { data, error } = await (supabase as any).from('tenant_emitters').update(patch).eq('id', id).select().single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await (supabase as any).from('tenant_emitters').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant_emitters'] });
      toast.success('Emitente salvo');
    },
    onError: (e: any) => toast.error(e?.message || 'Falha ao salvar emitente'),
  });
}

export function useDeleteEmitter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('tenant_emitters').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant_emitters'] });
      toast.success('Emitente removido');
    },
    onError: (e: any) => toast.error(e?.message || 'Falha ao remover'),
  });
}

export function useMakeDefaultEmitter() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      // Unset current default, then set new default
      await (supabase as any).from('tenant_emitters').update({ is_default: false })
        .eq('tenant_id', currentTenant.id).eq('is_default', true);
      const { error } = await (supabase as any).from('tenant_emitters').update({ is_default: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant_emitters'] }),
  });
}

export function useHubCredentials(emitterId?: string | null) {
  return useQuery({
    queryKey: ['hub_fiscal_credentials', emitterId],
    enabled: !!emitterId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('hub_fiscal_credentials')
        .select('id, tenant_id, emitter_id, doc_scope, environment, secret_name, secret_hint, secret_ciphertext, enabled, metadata, created_at, updated_at')
        .eq('emitter_id', emitterId!)
        .order('doc_scope');
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        has_ciphertext: !!r.secret_ciphertext,
        secret_ciphertext: undefined,
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
      const payload: any = { ...input, tenant_id: currentTenant.id };
      if (input.id) {
        const { id, ...patch } = payload;
        const { data, error } = await (supabase as any).from('hub_fiscal_credentials').update(patch).eq('id', id).select().single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await (supabase as any).from('hub_fiscal_credentials').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['hub_fiscal_credentials', vars.emitter_id] });
      toast.success('Credencial salva');
    },
    onError: (e: any) => toast.error(e?.message || 'Falha ao salvar credencial'),
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
      if (error) throw new Error((error as any)?.message || 'Falha ao salvar token');
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['hub_fiscal_credentials', vars.emitter_id] });
      toast.success('Token do Hub Fiscal salvo com segurança');
    },
    onError: (e: any) => toast.error(e?.message || 'Falha ao salvar token'),
  });
}

export function useDeleteHubCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, emitter_id }: { id: string; emitter_id: string }) => {
      const { error } = await (supabase as any).from('hub_fiscal_credentials').delete().eq('id', id);
      if (error) throw error;
      return emitter_id;
    },
    onSuccess: (emitter_id) => qc.invalidateQueries({ queryKey: ['hub_fiscal_credentials', emitter_id] }),
  });
}