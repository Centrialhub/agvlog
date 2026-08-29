import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type BankAccountType = 'checking' | 'savings' | 'cash' | 'company_card' | 'pix' | 'other';
export type BankAccount = Omit<Tables<'bank_accounts'>, 'account_type'> & { account_type: BankAccountType };
export type CreateBankAccountInput = Omit<TablesInsert<'bank_accounts'>, 'tenant_id' | 'created_by'>;
export type UpdateBankAccountInput = TablesUpdate<'bank_accounts'> & { id: string };

export function useBankAccounts() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['bank_accounts', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('name');
      if (error) throw error;
      return (data || []) as unknown as BankAccount[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateBankAccount() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateBankAccountInput) => {
      const { data, error } = await supabase.from('bank_accounts').insert({
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank_accounts'] }),
  });
}

export function useUpdateBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: UpdateBankAccountInput) => {
      const { data, error } = await supabase.from('bank_accounts').update(values).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank_accounts'] }),
  });
}

export type BankTransactionType = 'credit' | 'debit';
export type ReconciliationStatus = 'unmatched' | 'suggested' | 'matched' | 'ignored' | 'manual_review';
export type BankTransaction = Omit<Tables<'bank_transactions'>, 'transaction_type' | 'reconciliation_status'> & {
  transaction_type: BankTransactionType;
  reconciliation_status: ReconciliationStatus;
};

export function useBankTransactions(bankAccountId: string | null, periodStart: string, periodEnd: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['bank_transactions', currentTenant?.id, bankAccountId, periodStart, periodEnd],
    queryFn: async () => {
      if (!currentTenant || !bankAccountId) return [];
      const { data, error } = await supabase
        .from('bank_transactions')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('bank_account_id', bankAccountId)
        .gte('posted_at', periodStart)
        .lte('posted_at', periodEnd + 'T23:59:59')
        .order('posted_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as unknown as BankTransaction[];
    },
    enabled: !!currentTenant && !!bankAccountId,
  });
}

export function useCreateManualTransaction() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      bank_account_id: string;
      posted_at: string;
      description: string;
      amount: number;
      transaction_type: 'credit' | 'debit';
      document_number?: string;
      cost_center?: string;
    }) => {
      const { data, error } = await supabase.from('bank_transactions').insert({
        tenant_id: currentTenant!.id,
        bank_account_id: payload.bank_account_id,
        posted_at: payload.posted_at,
        description: payload.description,
        amount: payload.amount,
        transaction_type: payload.transaction_type,
        document_number: payload.document_number || null,
        cost_center: payload.cost_center || null,
        reconciliation_status: 'unmatched',
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank_transactions'] });
    },
  });
}

export type FinancialObligation = Omit<Tables<'financial_obligations'>, 'direction'> & {
  direction: 'inflow' | 'outflow';
};

export type SuggestedMatch = Tables<'financial_matches'> & {
  bank_transactions: Pick<Tables<'bank_transactions'>, 'id' | 'bank_account_id' | 'posted_at' | 'description' | 'amount'>;
  financial_obligations: Pick<Tables<'financial_obligations'>, 'id' | 'description' | 'counterparty_name' | 'amount_expected' | 'open_balance'> | null;
};

export function useFinancialObligations(periodStart: string, periodEnd: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['financial_obligations', currentTenant?.id, periodStart, periodEnd],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('financial_obligations')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .or(`due_date.gte.${periodStart},due_date.is.null`)
        .or(`due_date.lte.${periodEnd},due_date.is.null`)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as unknown as FinancialObligation[];
    },
    enabled: !!currentTenant,
  });
}

export function useSuggestedMatches(bankAccountId: string | null) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['financial_matches_suggested', currentTenant?.id, bankAccountId],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('financial_matches')
        .select('*, bank_transactions!inner(id, bank_account_id, posted_at, description, amount), financial_obligations(id, description, counterparty_name, amount_expected, open_balance)')
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'suggested')
        .limit(500);
      if (error) throw error;
      const rows = data || [];
      return bankAccountId ? rows.filter(r => r.bank_transactions?.bank_account_id === bankAccountId) : rows;
    },
    enabled: !!currentTenant,
  });
}

export function useSyncObligations() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ from, to }: { from?: string | null; to?: string | null }) => {
      const { data, error } = await supabase.rpc('sync_financial_obligations', {
        _tenant_id: currentTenant!.id, _date_from: from ?? undefined, _date_to: to ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['financial_obligations'] });
    },
  });
}

export function useImportBankStatement() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      bank_account_id: string;
      file_name: string;
      file_hash: string;
      period_start: string;
      period_end: string;
      rows: Json[];
      raw_metadata?: Json;
    }) => {
      const { data, error } = await supabase.rpc('import_bank_statement', {
        _tenant_id: currentTenant!.id,
        _bank_account_id: payload.bank_account_id,
        _file_name: payload.file_name,
        _file_hash: payload.file_hash,
        _period_start: payload.period_start,
        _period_end: payload.period_end,
        _rows: payload.rows,
        _raw_metadata: payload.raw_metadata ?? {},
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank_transactions'] });
      qc.invalidateQueries({ queryKey: ['bank_statement_imports'] });
    },
  });
}

export function useRunReconciliation() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { bank_account_id: string; period_start: string; period_end: string }) => {
      const { data, error } = await supabase.rpc('run_bank_reconciliation', {
        _tenant_id: currentTenant!.id,
        _bank_account_id: payload.bank_account_id,
        _period_start: payload.period_start,
        _period_end: payload.period_end,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank_transactions'] });
      qc.invalidateQueries({ queryKey: ['financial_obligations'] });
      qc.invalidateQueries({ queryKey: ['financial_matches_suggested'] });
    },
  });
}

export function useAcceptMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (matchId: string) => {
      const { error } = await supabase.rpc('accept_financial_match', { _match_id: matchId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank_transactions'] });
      qc.invalidateQueries({ queryKey: ['financial_obligations'] });
      qc.invalidateQueries({ queryKey: ['financial_matches_suggested'] });
    },
  });
}

export function useRejectMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ matchId, reason }: { matchId: string; reason: string }) => {
      const { error } = await supabase.rpc('reject_financial_match', { _match_id: matchId, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank_transactions'] });
      qc.invalidateQueries({ queryKey: ['financial_obligations'] });
      qc.invalidateQueries({ queryKey: ['financial_matches_suggested'] });
    },
  });
}

export function useCreateManualMatch() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      bank_transaction_id: string;
      financial_obligation_id: string;
      amount_matched: number;
      reason?: string | null;
    }) => {
      const { error } = await supabase.rpc('create_manual_financial_match', {
        _tenant_id: currentTenant!.id,
        _bank_transaction_id: payload.bank_transaction_id,
        _financial_obligation_id: payload.financial_obligation_id,
        _amount_matched: payload.amount_matched,
        _reason: payload.reason ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank_transactions'] });
      qc.invalidateQueries({ queryKey: ['financial_obligations'] });
      qc.invalidateQueries({ queryKey: ['financial_matches_suggested'] });
    },
  });
}

export function useReverseMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ matchId, reason }: { matchId: string; reason: string }) => {
      const { error } = await supabase.rpc('reverse_financial_match', { _match_id: matchId, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank_transactions'] });
      qc.invalidateQueries({ queryKey: ['financial_obligations'] });
      qc.invalidateQueries({ queryKey: ['financial_matches_suggested'] });
    },
  });
}
