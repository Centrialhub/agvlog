import type { SupabaseClient } from '@supabase/supabase-js';
import { driverLoginEmail, validateDriverPassword } from '../_shared/driverCredentials.ts';

type CommandInput = { tenantId: string; actorId: string; userId: string; requestId: string;
  action: 'convert' | 'password' | 'credential_status'; driverId?: string; username?: unknown; password?: unknown };
type Receipt = { state: 'pending' | 'succeeded' | 'cancelled'; request_id: string; username?: string | null };
const uncertain = (requestId: string) => ({ status: 503, body: { state: 'unconfirmed', request_id: requestId,
  error: 'O resultado ainda não foi confirmado. Verifique esta solicitação antes de iniciar outra alteração.' } });

// No retry of the Auth request. Its SQL receipt, not the HTTP status, is authoritative.
export async function handleWorkspaceCredentialCommand(admin: SupabaseClient, input: CommandInput) {
  const args = { _tenant_id: input.tenantId, _actor_id: input.actorId, _user_id: input.userId, _request_id: input.requestId };
  const reconcile = async (cancel: boolean) => {
    try {
      const result = await admin.rpc('driver_workspace_credential_status_v1', { ...args, _cancel: cancel });
      if (result.error || !result.data || result.data.request_id !== input.requestId) return uncertain(input.requestId);
      const receipt = result.data as Receipt;
      if (receipt.state === 'succeeded') return { status: 200, body: { success: true, ...receipt } };
      if (receipt.state === 'cancelled') return { status: 409, body: { ...receipt,
        error: 'Esta solicitação não foi aplicada. Confira o acesso antes de iniciar uma nova alteração.' } };
      return uncertain(input.requestId);
    } catch { return uncertain(input.requestId); }
  };
  if (input.action === 'credential_status') return reconcile(true);
  if (typeof input.password !== 'string') return { status: 400, body: { error: 'Informe a nova senha.' } };
  let email: string | null = null;
  try {
    validateDriverPassword(input.password);
    if (input.action === 'convert') {
      if (typeof input.username !== 'string') throw new Error('Informe o usuário.');
      email = driverLoginEmail(input.username);
    }
  } catch (error) { return { status: 400, body: { error: error instanceof Error ? error.message : 'Credenciais inválidas.' } }; }
  const nonce = crypto.randomUUID() + crypto.randomUUID();
  try {
    const prepared = await admin.rpc('prepare_driver_workspace_credentials_v1', {
      ...args, _action: input.action, _email: email, _nonce: nonce, _driver_id: input.driverId ?? null,
    });
    if (prepared.error || !prepared.data || prepared.data.request_id !== input.requestId) return reconcile(true);
    if (prepared.data.dispatch !== true) return reconcile(false);
    if (prepared.data.state !== 'pending' || typeof prepared.data.email !== 'string'
      || (input.action === 'convert' && prepared.data.email !== email)) return reconcile(true);
    try {
      const result = await admin.auth.admin.updateUserById(input.userId, {
        password: input.password,
        ...(input.action === 'convert' ? { email: prepared.data.email, email_confirm: true } : {}),
        app_metadata: { driver_credential_request_id: input.requestId, driver_credential_nonce: nonce },
      });
      // Never echo the Auth object: it can contain the transient server nonce.
      return reconcile(!!result.error);
    } catch { return reconcile(true); }
  } catch { return reconcile(true); }
}
