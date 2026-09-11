import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import {invalidateAccountDirectory} from '@/lib/financial/invalidateAccountReview';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type BankAccountType = 'checking' | 'savings' | 'cash' | 'company_card' | 'pix' | 'other';
export type BankAccount = Omit<Tables<'bank_accounts'>, 'account_type'> & { account_type: BankAccountType };
export type CreateBankAccountInput = Omit<TablesInsert<'bank_accounts'>, 'tenant_id' | 'created_by'>;
export type UpdateBankAccountInput = TablesUpdate<'bank_accounts'> & { id: string };

export function useBankAccounts() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['bank_accounts', currentTenant?.id,user?.id],
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
    enabled: !!currentTenant&&!!user,
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
    onSuccess: data => invalidateAccountDirectory(qc,data.tenant_id),
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
    onSuccess: data => invalidateAccountDirectory(qc,data.tenant_id),
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
