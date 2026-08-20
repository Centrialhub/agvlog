import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { toast } from '@/hooks/use-toast';

export interface OperationalLedgerEntry {
  id: string;
  tenant_id: string;
  source_table: string;
  source_id: string;
  entry_type: string;
  nature: 'credit' | 'debit';
  amount: number;
  status: 'active' | 'reversed' | 'voided';
  metadata: Record<string, any>;
  created_at: string;
}

export function useOperationalLedger(filters: { source_id?: string; source_table?: string } = {}) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['operational_ledger', currentTenant?.id, filters],
    queryFn: async () => {
      if (!currentTenant) return [];
      let query = supabase
        .from('operational_ledger')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });

      if (filters.source_id) query = query.eq('source_id', filters.source_id);
      if (filters.source_table) query = query.eq('source_table', filters.source_table);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as OperationalLedgerEntry[];
    },
    enabled: !!currentTenant,
  });
}

export function useApproveFinancialObligation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      const { data, error } = await supabase.rpc('approve_financial_obligation_v1', {
        _obligation_id: id,
        _notes: notes || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Obrigação aprovada' });
      qc.invalidateQueries({ queryKey: ['financial_obligations'] });
    },
    onError: (e: any) => toast({ title: 'Erro ao aprovar', description: e.message, variant: 'destructive' }),
  });
}

export function useReverseFinancialObligation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data, error } = await supabase.rpc('reverse_financial_obligation_v1', {
        _obligation_id: id,
        _reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Obrigação estornada' });
      qc.invalidateQueries({ queryKey: ['financial_obligations'] });
    },
    onError: (e: any) => toast({ title: 'Erro ao estornar', description: e.message, variant: 'destructive' }),
  });
}
