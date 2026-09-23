import {supabase} from '@/integrations/supabase/client';
import {settlementExpenseContextSchema} from './settlementExpenseContextContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string;code?:string}|null}>;
export class SettlementExpenseSnapshotChangedError extends Error {}
export async function readSettlementExpenseContext(tenant:string,settlement:string,page:number,expectedRevision:string|null=null){
 const {data,error}=await (supabase.rpc.bind(supabase) as unknown as Rpc)('get_finance_settlement_expense_context_v2',{_tenant_id:tenant,_settlement_id:settlement,_page:page,_expected_revision:expectedRevision});
 if(error){if(error.code==='40001'||error.message.includes('finance_settlement_expense_context_changed'))throw new SettlementExpenseSnapshotChangedError('Os gastos mudaram durante a navegação.');throw new Error(error.message);}const result=settlementExpenseContextSchema.parse(data);
 if(result.tenant_id!==tenant||result.settlement_id!==settlement||result.page!==page)throw new Error('Gastos fora do contexto do acerto.');return result;
}
