import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export interface FinancialKPIs {
  revenue: number;
  outflow: number;
  balance: number;
  totalReceivable: number;
  pendingReceivable: number;
  paidReceivable: number;
  overdueReceivable: number;
  totalExpenses: number;
  totalMaintenance: number;
  ledgerBalance: number;
}

export function useOperationalFinancialSummary(periodStart: string, periodEnd: string) {
  const { currentTenant } = useTenant();
  
  return useQuery({
    queryKey: ['operational_financial_summary', currentTenant?.id, periodStart, periodEnd],
    enabled: !!currentTenant,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_operational_financial_summary_v1', {
        _tenant_id: currentTenant!.id,
        _date_from: periodStart,
        _date_to: periodEnd
      });
      
      if (error) throw error;
      return data as FinancialKPIs;
    }
  });
}
