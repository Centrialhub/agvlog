import type {QueryClient} from '@tanstack/react-query';
export async function refreshReceivableAdjustment(cache:QueryClient,tenant:string){
 const scoped=['finance-receivable-adjustment-preview','finance-receivable-adjustments','receivable-financial-context','receivable-agreement-position','receivables','finance-receivable-portfolio','finance-receivable-history','finance-customer-credit-options','finance-customer-credit-preview','finance-cash-forecast-preview','finance-cash-forecast-agenda','finance-audit'];
 const projections=['client_invoices','client_invoice_detail','client-invoice-context','closing-reports','closing-report','closing-action-context'];
 await cache.invalidateQueries({predicate:q=>scoped.includes(String(q.queryKey[0]))&&q.queryKey[1]===tenant||projections.includes(String(q.queryKey[0]))||q.queryKey[0]==='finance-cash-forecast-sources'&&q.queryKey[1]===tenant&&q.queryKey[3]===null},{throwOnError:true});
}
