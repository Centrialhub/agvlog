import {supabase} from '@/integrations/supabase/client';
import {receivablePaymentsPageSchema,receivablePaymentsRequestSchema,type ReceivablePaymentsRequest} from './receivablePaymentsContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export class ReceivablePaymentsChangedError extends Error{
 constructor(){super('Os recebimentos mudaram durante a consulta. Atualize para consultar a primeira página.');this.name='ReceivablePaymentsChangedError';}
}
export async function readReceivablePayments(request:ReceivablePaymentsRequest){
 const input=receivablePaymentsRequestSchema.parse(request);
 const {data,error}=await(supabase.rpc as unknown as Rpc)('get_finance_receivable_payments_page',{_tenant_id:input.tenantId,_receivable_id:input.receivableId,_page:input.page,_expected_revision:input.expectedRevision});
 if(error){if(typeof error==='object'&&'code' in error&&error.code==='40001')throw new ReceivablePaymentsChangedError();throw error;}
 const result=receivablePaymentsPageSchema.parse(data);
 if(result.tenant_id!==input.tenantId||result.actor_id!==input.actorId||result.receivable_id!==input.receivableId||result.page!==input.page)throw new Error('Recebimentos fora do contexto solicitado.');
 if(input.expectedRevision!==null&&result.revision!==input.expectedRevision)throw new ReceivablePaymentsChangedError();
 return result;
}
