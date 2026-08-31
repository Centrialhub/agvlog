import { useMemo } from 'react';
import { useBillingDocuments } from './useBillingDocuments';

export interface PendingInvoiceSummary {
  count: number;
  totalValue: number;
  invoiceIds: string[];
  oldestIssueDate: string | null;
}

/** Use exactly the same unbilled-invoice source as CT-e and NFS-e selection. */
export function usePendingInvoices() {
  const query = useBillingDocuments({}, 'all');
  const data = useMemo<PendingInvoiceSummary>(() => {
    const docs = query.data || [];
    const dates = docs.map(d => d.issue_date).filter((date): date is string => !!date).sort();
    return {count: docs.length, totalValue: docs.reduce((sum, d) => sum + Number(d.value || 0), 0),
      invoiceIds: docs.map(d => d.id), oldestIssueDate: dates[0] || null};
  }, [query.data]);
  return {...query, data};
}
