import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { isBillableNfse } from '@/lib/fiscal/documentStatus';

export interface PendingInvoiceSummary {
  count: number;
  totalValue: number;
  invoiceIds: string[];
  oldestIssueDate: string | null;
}

/**
 * Conta NF-e (inbound) que estão elegíveis para faturamento mas ainda não
 * foram vinculadas a nenhum CT-e (cte_documents.fiscal_document_ids).
 */
export function usePendingInvoices() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['pending_invoices_summary', currentTenant?.id],
    enabled: !!currentTenant,
    staleTime: 60_000,
    queryFn: async (): Promise<PendingInvoiceSummary> => {
      if (!currentTenant) return { count: 0, totalValue: 0, invoiceIds: [], oldestIssueDate: null };

      // Pega NF-e inbound não canceladas do tenant.
      const { data: docs, error: e1 } = await supabase
        .from('fiscal_documents')
        .select('id, value, issue_date')
        .eq('tenant_id', currentTenant.id)
        .eq('document_type', 'inbound')
        .neq('status', 'cancelled')
        // Mesmo critério da tela de faturamento: NF já usada em CT-e/NFS-e não é pendente
        .is('cte_emitted_at', null)
        .is('nfse_emitted_at', null)
        .order('issue_date', { ascending: true })
        .limit(5000);
      if (e1) throw e1;

      const allIds = new Set<string>((docs || []).map((d: any) => d.id));
      if (allIds.size === 0) return { count: 0, totalValue: 0, invoiceIds: [], oldestIssueDate: null };

      // CT-e válidos (não cancelados nem rejeitados) que já consumiram NF.
      const { data: ctes, error: e2 } = await supabase
        .from('cte_documents')
        .select('fiscal_document_ids, status')
        .eq('tenant_id', currentTenant.id)
        .not('status', 'in', '("cancelled","rejected")');
      if (e2) throw e2;

      const used = new Set<string>();
      for (const c of (ctes || []) as any[]) {
        for (const id of (c.fiscal_document_ids || [])) used.add(id);
      }

      // NFS-e válidas também consomem NF do pool de faturamento.
      const { data: nfse, error: e3 } = await supabase
        .from('nfse_documents')
        .select('fiscal_document_ids, status')
        .eq('tenant_id', currentTenant.id);
      if (e3) throw e3;
      for (const n of (nfse || []) as any[]) {
        if (!isBillableNfse(n)) continue;
        for (const id of (n.fiscal_document_ids || [])) used.add(id);
      }

      let count = 0;
      let totalValue = 0;
      let oldest: string | null = null;
      const pendingIds: string[] = [];
      for (const d of (docs || []) as any[]) {
        if (used.has(d.id)) continue;
        count++;
        totalValue += Number(d.value ?? 0);
        pendingIds.push(d.id);
        if (d.issue_date && (!oldest || d.issue_date < oldest)) oldest = d.issue_date;
      }

      return { count, totalValue, invoiceIds: pendingIds, oldestIssueDate: oldest };
    },
  });
}