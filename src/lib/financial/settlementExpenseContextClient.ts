import {supabase} from '@/integrations/supabase/client';
import {settlementExpenseContextSchema} from './settlementExpenseContextContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string}|null}>;
export async function readSettlementExpenseContext(tenant:string,settlement:string,page:number){
 const {data,error}=await (supabase.rpc as unknown as Rpc)('get_finance_settlement_expense_context',{_tenant_id:tenant,_settlement_id:settlement,_page:page});
 if(error)throw new Error(error.message);const result=settlementExpenseContextSchema.parse(data);
 if(result.tenant_id!==tenant||result.settlement_id!==settlement||result.page!==page)throw new Error('Gastos fora do contexto do acerto.');return result;
}
