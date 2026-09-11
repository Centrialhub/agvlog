import {supabase} from '@/integrations/supabase/client';
import {receivableHistoryRequestSchema,receivableHistorySchema,type ReceivableHistoryRequest} from './receivableHistoryContract';

type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export class ReceivableHistoryChangedError extends Error{
 constructor(){super('O histórico mudou durante a consulta. Atualize para voltar à primeira página.');this.name='ReceivableHistoryChangedError';}
}
export async function readReceivableHistory(request:ReceivableHistoryRequest){
 const input=receivableHistoryRequestSchema.parse(request);
 const {data,error}=await(supabase.rpc as unknown as Rpc)('get_finance_receivable_history',{
  _tenant_id:input.tenantId,_receivable_id:input.receivableId,_page:input.page,_expected_revision:input.expectedRevision,
 });
 if(error){
  if(typeof error==='object'&&'code' in error&&error.code==='40001')throw new ReceivableHistoryChangedError();
  throw error;
 }
 const result=receivableHistorySchema.parse(data);
 if(result.tenant_id!==input.tenantId||result.receivable_id!==input.receivableId||result.page!==input.page)throw new Error('Histórico fora da empresa, título ou página solicitada.');
 if(input.expectedRevision!==null&&result.revision!==input.expectedRevision)throw new ReceivableHistoryChangedError();
 return result;
}
