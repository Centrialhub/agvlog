import {supabase} from '@/integrations/supabase/client';
import {employeeAdvanceRegistrationCommandSchema,type EmployeeAdvanceRegistrationCommand} from './employeeAdvanceRegistrationContract';
type Rpc=(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>;
export function sendEmployeeAdvanceRegistration(command:EmployeeAdvanceRegistrationCommand){return(supabase.rpc.bind(supabase) as unknown as Rpc)('record_finance_employee_advance',{_payload:employeeAdvanceRegistrationCommandSchema.parse(command)});}
