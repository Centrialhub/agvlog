import {useQuery} from '@tanstack/react-query';
import {readRecordedCostSummary} from '@/lib/financial/recordedCostSummaryClient';
import type {RecordedCostFilters} from '@/lib/financial/recordedCostSummaryContract';
export function useRecordedCostSummary(tenant:string|undefined,actor:string|undefined,filters:RecordedCostFilters){const query=useQuery({queryKey:['finance-recorded-cost-summary',tenant,actor,filters.from,filters.to,filters.category,filters.costCenter],queryFn:()=>readRecordedCostSummary(tenant!,filters),enabled:!!tenant&&!!actor,retry:false});return {query,data:query.isFetching||query.isError?undefined:query.data};}
export type RecordedCostState=ReturnType<typeof useRecordedCostSummary>;
