import {useQuery} from '@tanstack/react-query';
import {readFiscalDashboard} from '@/lib/financial/fiscalDashboardClient';
import type {FiscalDashboardFilters} from '@/lib/financial/fiscalDashboardContract';
export function useFiscalDashboardSummary(tenant:string|undefined,actor:string|undefined,filters:FiscalDashboardFilters){const query=useQuery({queryKey:['finance-fiscal-dashboard-summary',tenant,actor,filters.from,filters.to,filters.client,filters.docType],queryFn:()=>readFiscalDashboard(tenant!,filters),enabled:!!tenant&&!!actor,retry:false});return {query,data:query.isFetching||query.isError?undefined:query.data};}
export type FiscalDashboardState=ReturnType<typeof useFiscalDashboardSummary>;
