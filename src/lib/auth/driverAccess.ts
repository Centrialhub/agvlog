import { supabase } from '@/integrations/supabase/client';
import { edgeFunctionErrorMessage } from '@/lib/supabase/edgeFunctionError';

export type DriverAccessState = { kind: 'none' | 'legacy' | 'managed'; username: string | null; user_id?: string; active?: boolean };

export async function driverAccessRequest<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>('manage-driver-access', { body });
  if (error) throw new Error(await edgeFunctionErrorMessage(error, 'Não foi possível gerenciar o acesso.'));
  if (data?.error) throw new Error(data.error);
  if (!data) throw new Error('O serviço não confirmou a operação.');
  return data;
}
