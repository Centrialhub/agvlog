import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Json, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

interface OverrideInput {
  fiscalDocumentId: string;
  newValue: number;
  reason: string;
  previousValue: number | null;
  freightBreakdown: Json | null;
}

export function useOverrideFreightValue() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: OverrideInput) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      if (!input.reason || input.reason.trim().length < 3) {
        throw new Error('Justificativa obrigatória (mínimo 3 caracteres)');
      }
      if (input.newValue < 0) throw new Error('Valor inválido');

      const cbsRate = 0.90;
      const ibsRate = 0.10;
      const cbsValue = input.newValue > 0 ? input.newValue * cbsRate / 100 : null;
      const ibsValue = input.newValue > 0 ? input.newValue * ibsRate / 100 : null;

      const update: TablesUpdate<'fiscal_documents'> = {
        freight_value: input.newValue,
        value: input.newValue,
        freight_overridden: true,
        freight_override_reason: input.reason.trim(),
        freight_overridden_by: user?.id || null,
        freight_overridden_at: new Date().toISOString(),
        cbs_base: input.newValue > 0 ? input.newValue : null,
        cbs_value: cbsValue,
        ibs_base: input.newValue > 0 ? input.newValue : null,
        ibs_value: ibsValue,
      };
      const { error: upErr } = await supabase
        .from('fiscal_documents')
        .update(update)
        .eq('id', input.fiscalDocumentId)
        .eq('tenant_id', currentTenant.id);

      if (upErr) throw upErr;

      const audit: TablesInsert<'freight_override_log'> = {
        tenant_id: currentTenant.id,
        fiscal_document_id: input.fiscalDocumentId,
        previous_value: input.previousValue,
        new_value: input.newValue,
        reason: input.reason.trim(),
        changed_by: user?.id || null,
        freight_breakdown_snapshot: input.freightBreakdown ?? null,
      };
      const { error: auditError } = await supabase.from('freight_override_log').insert(audit);
      if (auditError) throw auditError;

      return { ok: true };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['load_documents'] });
    },
  });
}

export function useConfirmFreightValue() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (fiscalDocumentId: string) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const update: TablesUpdate<'fiscal_documents'> = {
        freight_confirmed_by: user?.id || null,
        freight_confirmed_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('fiscal_documents')
        .update(update)
        .eq('id', fiscalDocumentId)
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
      return { ok: true };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['load_documents'] });
    },
  });
}
