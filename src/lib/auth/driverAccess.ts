import { supabase } from '@/integrations/supabase/client';
import { edgeFunctionErrorMessage } from '@/lib/supabase/edgeFunctionError';

export type DriverAccessState = {
  kind: 'none' | 'legacy' | 'managed' | 'linked'; username: string | null; user_id?: string; active?: boolean;
  version?: 2 | 3; driver_id?: string | null; command_pending?: boolean; pending_request_id?: string | null;
  capabilities?: { create_access: boolean; change_password: boolean; change_identity: boolean; delete_identity: false; unlink: false };
};

export async function driverAccessRequest<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>('manage-driver-access', { body });
  if (error) throw new Error(await edgeFunctionErrorMessage(error, 'Não foi possível gerenciar o acesso.'));
  if (data?.error) throw new Error(data.error);
  if (!data) throw new Error('O serviço não confirmou a operação.');
  return data;
}

export async function driverCredentialStatusRequest(body: Record<string, unknown>): Promise<{state: string; request_id: string}> {
  const {data,error}=await supabase.functions.invoke<{state?:string;request_id?:string}>('manage-driver-access',
    {body:{...body,action:'credential_status'}});
  let receipt=data;
  if(error && 'context' in error && error.context instanceof Response) {
    receipt=await error.context.clone().json().catch(()=>null);
  }
  if(receipt?.request_id!==body.request_id || !['succeeded','cancelled'].includes(receipt?.state??''))
    throw new Error('O resultado ainda não foi confirmado. Verifique esta solicitação antes de iniciar outra alteração.');
  return {state:receipt!.state!,request_id:receipt!.request_id!};
}
