import {supabase} from '@/integrations/supabase/client';
import {employeeAdvancePaymentCommandSchema,employeeAdvancePaymentPreviewSchema,type EmployeeAdvancePaymentCommand} from './employeeAdvancePaymentContract';
type Rpc=(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>;
const rpc=supabase.rpc.bind(supabase) as unknown as Rpc;
export async function readEmployeeAdvancePayment(tenant:string,actor:string,advance:string,movement:string|null,amount:string|null){
 const {data,error}=await rpc('preview_finance_employee_advance_payment',{_tenant_id:tenant,_advance_id:advance,_movement_id:movement,_amount_cents:amount});if(error)throw error;
 const value=employeeAdvancePaymentPreviewSchema.parse(data);if(value.tenant_id!==tenant||value.actor_id!==actor||value.advance_id!==advance||value.movement_id!==movement||value.amount_cents!==amount)throw Error('A conferência recebida não corresponde ao adiantamento e aos valores solicitados.');return value;
}
export const sendEmployeeAdvancePayment=(payload:EmployeeAdvancePaymentCommand)=>rpc('record_finance_employee_advance_payment',{_payload:employeeAdvancePaymentCommandSchema.parse(payload)});

import {employeeAdvancePaymentOptionsSchema,employeeAdvancePaymentHistorySchema} from './employeeAdvancePaymentContract';
export class EmployeeAdvancePaymentChangedError extends Error{constructor(){super('As saídas ou pagamentos mudaram. A primeira página foi atualizada; selecione e confira novamente.');}}
export async function readEmployeeAdvancePaymentPage(tenant:string,actor:string,advance:string,kind:'options'|'history',offset:number,expectedRevision:string|null,search=''){
 const {data,error}=await rpc(`get_finance_employee_advance_payment_${kind}`,{_tenant_id:tenant,_advance_id:advance,_query:{offset,limit:30,expected_revision:expectedRevision,...(kind==='options'?{search}:{})}});
 if(error){if(typeof error==='object'&&'code' in error&&error.code==='40001')throw new EmployeeAdvancePaymentChangedError();throw error;}
 const value=kind==='options'?employeeAdvancePaymentOptionsSchema.parse(data):employeeAdvancePaymentHistorySchema.parse(data);
 if(value.tenant_id!==tenant||value.actor_id!==actor||value.advance_id!==advance||value.offset!==offset||value.limit!==30||(offset>0&&value.revision!==expectedRevision)||value.rows.length>value.limit||value.next_offset!==(offset+value.rows.length<value.total?offset+value.rows.length:null))throw Error('Página incompatível com o adiantamento solicitado.');return value;
}
