import {useQuery} from '@tanstack/react-query';
import {readReceivablePortfolio} from '@/lib/financial/receivablePortfolioClient';
import type {PortfolioFilters} from '@/lib/financial/receivablePortfolioContract';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
export function useReceivablePortfolio(tenant:string|undefined,actor:string|undefined,filters:PortfolioFilters){const query=useQuery({queryKey:['finance-receivable-portfolio',tenant,actor,filters.from,filters.to,filters.client],queryFn:()=>readReceivablePortfolio(tenant!,filters),enabled:!!tenant&&!!actor,retry:false});return {query,data:query.isFetching||query.isError?undefined:query.data};}
export type PortfolioState=ReturnType<typeof useReceivablePortfolio>;
export function portfolioValue(state:PortfolioState,key:'open_cents'|'received_allocated_cents'|'nominal_cents'|'overdue_cents'){
 if(state.query.isFetching||state.query.isPending)return 'Consultando…';if(state.query.isError)return 'Indisponível';if(!state.data?.totals_valid||state.data[key]===null)return 'A revisar';return formatFinanceCents(state.data[key]!);
}
