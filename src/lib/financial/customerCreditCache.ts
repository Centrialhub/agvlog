import type {QueryClient} from '@tanstack/react-query';
export async function refreshCustomerCredit(cache:QueryClient,tenant:string){
 const scoped=['finance-customer-credit-options','finance-customer-credit-preview','receivable-financial-context','receivables','finance-receivable-portfolio','finance-receivable-payments','finance-receivable-history','finance-cash-forecast-preview','finance-cash-forecast-agenda','finance-audit'];
 const projections=['client_invoices','client_invoice_detail','client-invoice-context','closing-reports','closing-report','closing-action-context'];
 await cache.invalidateQueries({predicate:q=>scoped.includes(String(q.queryKey[0]))&&q.queryKey[1]===tenant||projections.includes(String(q.queryKey[0]))},{throwOnError:true});
}
