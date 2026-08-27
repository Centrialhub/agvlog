import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { validateUpload } from '@/lib/uploadPolicy';
import { useTenant } from './useTenant';

export const PAYMENT_METHODS = ['pix','boleto','ted','doc','dinheiro','cartao','debito_automatico','other'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'PIX', boleto: 'Boleto', ted: 'TED', doc: 'DOC',
  dinheiro: 'Dinheiro', cartao: 'Cartão',
  debito_automatico: 'Débito automático', other: 'Outro',
};

export function useBankAccounts() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['bank_accounts', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('bank_accounts')
        .select('id, name, bank_name, account_number, active')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });
}

export function usePayablePayments(payableId: string | null) {
  return useQuery({
    queryKey: ['payables_payments', payableId],
    queryFn: async () => {
      if (!payableId) return [];
      const { data, error } = await supabase
        .from('payables_payments')
        .select('*, bank_accounts(name)')
        .eq('payable_id', payableId)
        .order('paid_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!payableId,
  });
}

export function useReceivablePayments(receivableId: string | null) {
  return useQuery({
    queryKey: ['receivables_payments', receivableId],
    queryFn: async () => {
      if (!receivableId) return [];
      const { data, error } = await supabase
        .from('receivables_payments')
        .select('*, bank_accounts(name)')
        .eq('receivable_id', receivableId)
        .order('received_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!receivableId,
  });
}

export function useRegisterPayablePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      payable_id: string; amount: number; paid_at: string;
      bank_account_id: string; method: PaymentMethod;
      notes?: string | null; attachment_url?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('register_payable_payment', {
        _payable_id: args.payable_id,
        _amount: args.amount,
        _paid_at: args.paid_at,
        _bank_account_id: args.bank_account_id,
        _method: args.method,
        _notes: args.notes ?? null,
        _attachment_url: args.attachment_url ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['payables'] });
      qc.invalidateQueries({ queryKey: ['payables_payments', v.payable_id] });
      qc.invalidateQueries({ queryKey: ['bank_transactions'] });
    },
  });
}

export function useReversePayablePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payment_id: string) => {
      const { error } = await supabase.rpc('reverse_payable_payment', { _payment_id: payment_id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payables'] });
      qc.invalidateQueries({ queryKey: ['payables_payments'] });
      qc.invalidateQueries({ queryKey: ['bank_transactions'] });
    },
  });
}

export function useRegisterReceivablePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      receivable_id: string; amount: number; received_at: string;
      bank_account_id: string; method: PaymentMethod;
      notes?: string | null; attachment_url?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('register_receivable_payment', {
        _receivable_id: args.receivable_id,
        _amount: args.amount,
        _received_at: args.received_at,
        _bank_account_id: args.bank_account_id,
        _method: args.method,
        _notes: args.notes ?? null,
        _attachment_url: args.attachment_url ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['receivables'] });
      qc.invalidateQueries({ queryKey: ['receivables_payments', v.receivable_id] });
      qc.invalidateQueries({ queryKey: ['bank_transactions'] });
    },
  });
}

export function useReverseReceivablePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payment_id: string) => {
      const { error } = await supabase.rpc('reverse_receivable_payment', { _payment_id: payment_id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] });
      qc.invalidateQueries({ queryKey: ['receivables_payments'] });
      qc.invalidateQueries({ queryKey: ['bank_transactions'] });
    },
  });
}

export function useCreateManualExpense() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      const { data, error } = await supabase.rpc('create_manual_expense', {
        _payload: { ...payload, tenant_id: currentTenant!.id },
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payables'] });
      qc.invalidateQueries({ queryKey: ['bank_transactions'] });
    },
  });
}

export async function uploadPaymentAttachment(tenantId: string, kind: 'payable'|'receivable', file: File): Promise<string | null> {
  const { contentType, safeName } = validateUpload(file, 'financial');
  const path = `${tenantId}/${kind}-payments/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from('receipts').upload(path, file, { contentType });
  if (error) throw error;
  return path;
}