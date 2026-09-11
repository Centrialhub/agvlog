import {supabase} from '@/integrations/supabase/client';
import {z} from 'zod';
import {AccountOpeningRejectedError} from './accountOpeningClient';
import {cashOpeningCommandSchema,cashOpeningResultSchema,totalCashCounts,type CashOpeningCommand} from './cashOpeningContract';
const accountSchema=z.object({id:z.string().uuid(),tenant_id:z.string().uuid(),name:z.string(),account_type:z.enum(['cash','checking','savings','company_card','pix','other']),active:z.boolean()});
export async function readOpeningAccount(tenant:string,account:string){const {data,error}=await supabase.from('bank_accounts').select('id,tenant_id,name,account_type,active').eq('tenant_id',tenant).eq('id',account).single();if(error)throw new Error(error.message);const result=accountSchema.parse(data);if(result.tenant_id!==tenant||result.id!==account)throw new Error('Conta fora do contexto.');return result;}
export async function recordCashOpening(command:CashOpeningCommand){
 cashOpeningCommandSchema.parse(command);
 const {data,error}=await (supabase.rpc as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{message:string;code?:string}|null}>)('record_finance_cash_opening',{_payload:command});
 if(error){if(['22023','23514','23505','40001','42501','55000'].includes(error.code||''))throw new AccountOpeningRejectedError(error.message);throw new Error(error.message);}
 const result=cashOpeningResultSchema.parse(data);if(result.tenant_id!==command.tenant_id||result.request_id!==command.request_id||result.balance_cents!==totalCashCounts(command.counts))throw new Error('Contagem confirmada fora do pedido original.');return result;
}
