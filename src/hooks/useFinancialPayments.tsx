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
      const rows: Array<{id:string;name:string;bank_name:string|null;account_number:string|null;account_type:string;active:boolean}> = [];
      for (let from=0;;from+=1000) {
        const { data, error } = await supabase.from('bank_accounts').select('id, name, bank_name, account_number, account_type, active').eq('tenant_id', currentTenant.id).eq('active', true).order('name').order('id').range(from,from+999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return rows;
    },
    enabled: !!currentTenant&&!!user,
  });
}

export function usePayablePayments(payableId: string | null,page=1,expectedRevision:string|null=null) {
  const {currentTenant}=useTenant();
  return useQuery({
    queryKey: ['payables_payments', payableId,currentTenant?.id,page,expectedRevision],
    queryFn: async () => {
      if (!payableId||!currentTenant) throw new Error('Selecione a empresa e o título.');
      return readPayablePaymentHistory(currentTenant.id,payableId,page,expectedRevision);
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

export async function deletePaymentAttachment(tenantId:string,kind:'payable'|'receivable',path:string):Promise<void>{
  const prefix=`${tenantId}/${kind}-payments/`;
  if(!path.startsWith(prefix)||path.includes('..')||path.includes('\\'))throw new Error('Caminho de comprovante inválido.');
  const {error}=await supabase.storage.from('receipts').remove([path]);
  if(error)throw error;
}
