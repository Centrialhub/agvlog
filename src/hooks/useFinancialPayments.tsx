import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { uploadSecureFile } from '@/lib/secureUpload';
import {readPayablePaymentHistory} from '@/lib/financial/ledgerClient';

export const PAYMENT_METHODS = ['pix','boleto','ted','doc','dinheiro','cartao','debito_automatico','other'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'PIX', boleto: 'Boleto', ted: 'TED', doc: 'DOC',
  dinheiro: 'Dinheiro', cartao: 'Cartão',
  debito_automatico: 'Débito automático', other: 'Outro',
};

export function useBankAccounts() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['finance-active-accounts', currentTenant?.id,user?.id],
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
    enabled: !!currentTenant&&!!user,
  });
}

export function usePayablePayments(payableId: string | null,page=1) {
  const {currentTenant}=useTenant();
  return useQuery({
    queryKey: ['payables_payments', payableId,currentTenant?.id,page],
    queryFn: async () => {
      if (!payableId||!currentTenant) throw new Error('Selecione a empresa e o título.');
      return readPayablePaymentHistory(currentTenant.id,payableId,page);
    },
    enabled: !!payableId&&!!currentTenant,
  });
}



export async function uploadPaymentAttachment(tenantId: string, kind: 'payable'|'receivable', file: File): Promise<string | null> {
  return uploadSecureFile({
    tenantId,
    bucket: 'receipts',
    folder: `${kind}-payments`,
    file,
    kind: 'financial',
  });
}
