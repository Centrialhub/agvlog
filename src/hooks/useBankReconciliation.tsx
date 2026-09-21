import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import {invalidateAccountDirectory} from '@/lib/financial/invalidateAccountReview';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export type BankAccountType = 'checking' | 'savings' | 'money_market' | 'cash' | 'company_card' | 'pix' | 'other';
export type BankAccount = Omit<Tables<'bank_accounts'>, 'account_type'> & { account_type: BankAccountType };
export type CreateBankAccountInput = Omit<TablesInsert<'bank_accounts'>, 'tenant_id' | 'created_by'>;
export type UpdateBankAccountInput = TablesUpdate<'bank_accounts'> & { id: string };

export function useBankAccounts() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['bank_accounts', currentTenant?.id,user?.id],
    queryFn: async () => {
      if (!currentTenant || !user) throw new Error('Sessão ou empresa indisponível. Entre novamente.');
      const rows: BankAccount[] = [];
      for (let from=0;;from+=1000) {
        const { data, error } = await supabase.from('bank_accounts').select('*').eq('tenant_id', currentTenant.id).order('name').order('id').range(from,from+999);
        if (error) throw error;
        rows.push(...((data || []) as unknown as BankAccount[]));
        if (!data || data.length < 1000) break;
      }
      return rows;
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
      if (!currentTenant || !user) throw new Error('Sessão ou empresa indisponível. Entre novamente.');
      const { data, error } = await supabase.from('bank_accounts').insert({
        ...values,
        tenant_id: currentTenant.id,
        created_by: user.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: data => invalidateAccountDirectory(qc,data.tenant_id),
  });
}

export function useUpdateBankAccount() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: UpdateBankAccountInput) => {
      if (!currentTenant || !user) throw new Error('Sessão ou empresa indisponível. Entre novamente.');
      const { data, error } = await supabase
        .from('bank_accounts')
        .update(values)
        .eq('tenant_id', currentTenant.id)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: data => invalidateAccountDirectory(qc,data.tenant_id),
  });
}

export type BankTransactionType = 'credit' | 'debit';
export type ReconciliationStatus = 'unmatched' | 'suggested' | 'matched' | 'ignored' | 'manual_review';
export type LegacyTransactionView = 'all' | 'unmatched';
export type LegacyObligationView = 'all' | 'unmatched' | 'drivers';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.string().regex(/^\d+$/);
const suggestedMatchSchema = z.object({
  id: uuid,
  bank_transaction_id: uuid,
  financial_obligation_id: uuid,
  amount_matched: z.number(),
  obligation: z.object({
    id: uuid,
    description: z.string().nullable(),
    counterparty_name: z.string().nullable(),
    amount_expected: z.number(),
    open_balance: z.number(),
  }).nullable(),
}).strict();
const bankTransactionSchema = z.object({
  id: uuid,
  tenant_id: uuid,
  bank_account_id: uuid,
  posted_at: z.string(),
  description: z.string().nullable(),
  amount: z.number(),
  transaction_type: z.enum(['credit', 'debit']),
  reconciliation_status: z.enum(['unmatched', 'suggested', 'matched', 'ignored', 'manual_review']),
  document_number: z.string().nullable(),
  cost_center: z.string().nullable(),
  suggestions: z.array(suggestedMatchSchema),
}).strict();
const financialObligationSchema = z.object({
  id: uuid,
  tenant_id: uuid,
  due_date: isoDate.nullable(),
  obligation_type: z.string(),
  description: z.string().nullable(),
  counterparty_name: z.string().nullable(),
  amount_expected: z.number(),
  amount_matched: z.number(),
  open_balance: z.number(),
  status: z.string(),
  matching_status: z.string(),
}).strict();
const legacySummarySchema = z.object({
  version: z.literal(1),
  tenant_id: uuid,
  bank_account_id: uuid,
  period_start: isoDate,
  period_end: isoDate,
  transaction_count: z.number().int().nonnegative(),
  inflow_cents: cents,
  outflow_cents: cents,
  matched_count: z.number().int().nonnegative(),
  pending_count: z.number().int().nonnegative(),
  unmatched_transaction_count: z.number().int().nonnegative(),
  obligation_count: z.number().int().nonnegative(),
  unmatched_obligation_count: z.number().int().nonnegative(),
  suggestion_count: z.number().int().nonnegative(),
  driver_settlement_count: z.number().int().nonnegative(),
  driver_expense_count: z.number().int().nonnegative(),
  driver_pending_cents: cents,
}).strict();
const legacyPageBaseSchema = z.object({
  version: z.literal(1),
  tenant_id: uuid,
  bank_account_id: uuid,
  period_start: isoDate,
  period_end: isoDate,
  search: z.string(),
  status: z.enum(['all', 'unmatched', 'suggested', 'matched', 'ignored', 'manual_review']),
  direction: z.enum(['all', 'credit', 'debit']),
  page_size: z.literal(50),
  has_more: z.boolean(),
});
const transactionCursorSchema = z.object({ posted_at: z.string(), id: uuid }).strict();
const obligationCursorSchema = z.object({ due_date_key: isoDate, id: uuid }).strict();
const legacyTransactionPageSchema = legacyPageBaseSchema.extend({
  kind: z.literal('transactions'),
  view: z.enum(['all', 'unmatched']),
  next_cursor: transactionCursorSchema.nullable(),
  rows: z.array(bankTransactionSchema),
}).strict();
const legacyObligationPageSchema = legacyPageBaseSchema.extend({
  kind: z.literal('obligations'),
  view: z.enum(['all', 'unmatched', 'drivers']),
  next_cursor: obligationCursorSchema.nullable(),
  rows: z.array(financialObligationSchema),
}).strict();

export type SuggestedMatch = z.infer<typeof suggestedMatchSchema>;
export type BankTransaction = z.infer<typeof bankTransactionSchema>;
export type FinancialObligation = z.infer<typeof financialObligationSchema>;
export type LegacyReconciliationSummary = z.infer<typeof legacySummarySchema>;
export type LegacyTransactionPage = z.infer<typeof legacyTransactionPageSchema>;
export type LegacyObligationPage = z.infer<typeof legacyObligationPageSchema>;
export type LegacyTransactionCursor = z.infer<typeof transactionCursorSchema>;
export type LegacyObligationCursor = z.infer<typeof obligationCursorSchema>;

type FinanceRpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

async function legacyRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase.rpc.bind(supabase) as unknown as FinanceRpc)(name, args);
  if (error) throw new Error(error.message);
  return data;
}

function assertLegacyScope(
  result: { tenant_id: string; bank_account_id: string; period_start: string; period_end: string },
  tenant: string,
  bankAccount: string,
  periodStart: string,
  periodEnd: string,
) {
  if (result.tenant_id !== tenant || result.bank_account_id !== bankAccount
    || result.period_start !== periodStart || result.period_end !== periodEnd) {
    throw new Error('Histórico bancário fora do contexto.');
  }
}

export function useLegacyReconciliationSummary(
  bankAccountId: string | null,
  periodStart: string,
  periodEnd: string,
) {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['legacy_reconciliation_summary', currentTenant?.id, user?.id, bankAccountId, periodStart, periodEnd],
    queryFn: async () => {
      if (!currentTenant || !user || !bankAccountId) throw new Error('Sessão, empresa ou conta indisponível.');
      const result = legacySummarySchema.parse(await legacyRpc('get_finance_legacy_reconciliation_summary', {
        _tenant_id: currentTenant.id,
        _bank_account_id: bankAccountId,
        _period_start: periodStart,
        _period_end: periodEnd,
      }));
      assertLegacyScope(result, currentTenant.id, bankAccountId, periodStart, periodEnd);
      return result;
    },
    enabled: !!currentTenant && !!user && !!bankAccountId && !!periodStart && !!periodEnd,
  });
}

type TransactionFilters = {
  cursor?: LegacyTransactionCursor | null;
  view?: LegacyTransactionView;
  search?: string;
  status?: ReconciliationStatus | 'all';
  direction?: BankTransactionType | 'all';
};

export function useBankTransactions(
  bankAccountId: string | null,
  periodStart: string,
  periodEnd: string,
  filters: TransactionFilters = {},
  enabled = true,
) {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const cursor = filters.cursor ?? null;
  const view = filters.view ?? 'all';
  const search = filters.search ?? '';
  const status = filters.status ?? 'all';
  const direction = filters.direction ?? 'all';
  return useQuery({
    queryKey: ['legacy_reconciliation_rows', currentTenant?.id, user?.id, bankAccountId, periodStart, periodEnd,
      'transactions', view, search, status, direction, cursor],
    queryFn: async () => {
      if (!currentTenant || !user || !bankAccountId) throw new Error('Sessão, empresa ou conta indisponível.');
      const result = legacyTransactionPageSchema.parse(await legacyRpc('list_finance_legacy_reconciliation_rows', {
        _tenant_id: currentTenant.id,
        _bank_account_id: bankAccountId,
        _period_start: periodStart,
        _period_end: periodEnd,
        _kind: 'transactions',
        _view: view,
        _search: search,
        _status: status,
        _direction: direction,
        _cursor: cursor,
      }));
      assertLegacyScope(result, currentTenant.id, bankAccountId, periodStart, periodEnd);
      if (result.view !== view || result.search !== search
        || result.status !== status || result.direction !== direction
        || result.rows.some(row => row.tenant_id !== currentTenant.id || row.bank_account_id !== bankAccountId)) {
        throw new Error('Página de transações fora do contexto.');
      }
      return result;
    },
    enabled: enabled && !!currentTenant && !!user && !!bankAccountId && !!periodStart && !!periodEnd,
  });
}

type ObligationFilters = {
  cursor?: LegacyObligationCursor | null;
  view?: LegacyObligationView;
  search?: string;
};

export function useFinancialObligations(
  bankAccountId: string | null,
  periodStart: string,
  periodEnd: string,
  filters: ObligationFilters = {},
  enabled = true,
) {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const cursor = filters.cursor ?? null;
  const view = filters.view ?? 'all';
  const search = filters.search ?? '';
  return useQuery({
    queryKey: ['legacy_reconciliation_rows', currentTenant?.id, user?.id, bankAccountId, periodStart, periodEnd,
      'obligations', view, search, 'all', 'all', cursor],
    queryFn: async () => {
      if (!currentTenant || !user || !bankAccountId) throw new Error('Sessão, empresa ou conta indisponível.');
      const result = legacyObligationPageSchema.parse(await legacyRpc('list_finance_legacy_reconciliation_rows', {
        _tenant_id: currentTenant.id,
        _bank_account_id: bankAccountId,
        _period_start: periodStart,
        _period_end: periodEnd,
        _kind: 'obligations',
        _view: view,
        _search: search,
        _status: 'all',
        _direction: 'all',
        _cursor: cursor,
      }));
      assertLegacyScope(result, currentTenant.id, bankAccountId, periodStart, periodEnd);
      if (result.view !== view || result.search !== search
        || result.rows.some(row => row.tenant_id !== currentTenant.id)) {
        throw new Error('Página de títulos fora do contexto.');
      }
      return result;
    },
    enabled: enabled && !!currentTenant && !!user && !!bankAccountId && !!periodStart && !!periodEnd,
  });
}
