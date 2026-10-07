import type { SupabaseClient } from '@supabase/supabase-js';
import { requireActiveTenant } from '../_shared/active-tenant.ts';
import { driverLoginEmail, driverUsernameFromEmail, validateDriverPassword } from '../_shared/driverCredentials.ts';

type Scope = { managed: boolean; retired: boolean; deleted: boolean; active: boolean; email: string; tenant_id: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class AccessError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const scopeMessage = 'Conta compartilhada com outra empresa ou outro perfil. Revise os vínculos antes de excluir o acesso.';

export async function handleDriverAccess(
  req: Request, callerClient: SupabaseClient, admin: SupabaseClient, headers: Record<string, string>,
): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...headers, 'Content-Type': 'application/json' },
  });
  try {
    if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller) return json({ error: 'Sessão inválida.' }, 401);
    const body = await req.json().catch(() => null);
    if (!body || !uuid.test(body.tenant_id ?? '') || !['inspect', 'create', 'password', 'legacy_list', 'retire_legacy'].includes(body.action)) {
      return json({ error: 'Solicitação inválida.' }, 400);
    }
    const tenantId = body.tenant_id as string;
    // getUser above verifies the JWT before its signed tenant claim is consumed.
    const contextError = requireActiveTenant(req, tenantId, headers);
    if (contextError) return contextError;
    const { data: membership, error: membershipError } = await admin.from('tenant_memberships')
      .select('role').eq('tenant_id', tenantId).eq('user_id', caller.id).eq('active', true)
      .in('role', ['owner', 'admin']).maybeSingle();
    if (membershipError) throw new AccessError('Não foi possível validar as permissões.', 503);
    if (!membership) return json({ error: 'Acesso permitido apenas a administradores desta empresa.' }, 403);

    const getScope = async (userId: string, retire = false): Promise<Scope> => {
      const { data, error } = await admin.rpc('driver_access_scope_v1', {
        _tenant_id: tenantId, _actor_id: caller.id, _user_id: userId, _retire: retire,
      });
      if (error) {
        if (error.message.includes('shared_or_other_role')) throw new AccessError(scopeMessage, 409);
        if (error.message.includes('cannot_be_retired')) throw new AccessError('Esta conta já usa o novo modelo e não será excluída como conta antiga.', 409);
        throw new AccessError('Não foi possível validar o acesso deste motorista.', 409);
      }
      if (!data) throw new AccessError('Conta de motorista não encontrada.', 404);
      return data as Scope;
    };

    if (body.action === 'legacy_list') {
      const rows: Array<{ user_id: string }> = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await admin.from('tenant_memberships').select('user_id')
          .eq('tenant_id', tenantId).eq('role', 'driver').order('user_id').range(from, from + 499);
        if (error) throw new AccessError('Não foi possível consultar as contas antigas.', 503);
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < 500) break;
      }
      // Include linked accounts without a driver membership so inconsistent legacy links are visible.
      for (let from = 0; ; from += 500) {
        const { data, error } = await admin.from('drivers').select('user_id')
          .eq('tenant_id', tenantId).not('user_id', 'is', null).order('id').range(from, from + 499);
        if (error) throw new AccessError('Não foi possível consultar os vínculos antigos.', 503);
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < 500) break;
      }
      const ids = [...new Set(rows.map(row => row.user_id))];
      const accounts: Array<{ user_id: string; label: string; blocked: string | null }> = [];
      for (let index = 0; index < ids.length; index += 25) {
        const batch = await Promise.all(ids.slice(index, index + 25).map(async user_id => {
          try {
            const scope = await getScope(user_id);
            return !scope.managed && !scope.deleted ? { user_id, label: scope.email || user_id, blocked: null } : null;
          } catch (error) {
            if (!(error instanceof AccessError) || ![scopeMessage, 'Não foi possível validar o acesso deste motorista.'].includes(error.message)) throw error;
            return { user_id, label: user_id, blocked: error.message };
          }
        }));
        for (const account of batch) if (account) accounts.push(account);
      }
      return json({ accounts });
    }

    let userId = typeof body.user_id === 'string' && uuid.test(body.user_id) ? body.user_id : null;
    let driver: { id: string; name: string; user_id: string | null; active: boolean } | null = null;
    if (body.driver_id !== undefined) {
      if (!uuid.test(body.driver_id)) throw new AccessError('Motorista inválido.');
      const result = await admin.from('drivers').select('id,name,user_id,active')
        .eq('tenant_id', tenantId).eq('id', body.driver_id).maybeSingle();
      if (result.error) throw new AccessError('Não foi possível consultar o motorista.', 503);
      driver = result.data;
      if (!driver) throw new AccessError('Motorista não encontrado nesta empresa.', 404);
      userId = driver.user_id;
    }
    if (body.action === 'inspect') {
      if (!userId) {
        if (!driver) throw new AccessError('Motorista ou conta inválida.');
        return json({ kind: 'none', username: null });
      }
      const scope = await getScope(userId);
      const managed = scope.managed && scope.tenant_id === tenantId && !scope.retired && !scope.deleted;
      return json({ kind: managed ? 'managed' : 'legacy', user_id: userId, username: managed ? driverUsernameFromEmail(scope.email) : null, active: scope.active });
    }
    if (body.action === 'create') {
      if (!driver?.active || driver.user_id) throw new AccessError('O motorista deve estar ativo e sem uma conta vinculada.', 409);
      if (typeof body.username !== 'string' || typeof body.password !== 'string') throw new AccessError('Informe usuário e senha.');
      const email = driverLoginEmail(body.username);
      validateDriverPassword(body.password);
      const nonce = crypto.randomUUID() + crypto.randomUUID();
      const { data: name, error: prepareError } = await admin.rpc('prepare_driver_access_v1', {
        _tenant_id: tenantId, _actor_id: caller.id, _driver_id: driver.id, _email: email, _nonce: nonce,
      });
      if (prepareError) throw new AccessError('Não foi possível reservar o acesso. Atualize o cadastro e tente novamente.', 409);
      try {
        const { data, error } = await admin.auth.admin.createUser({
          email, password: body.password, email_confirm: true,
          user_metadata: { full_name: name, agvlog_invite_nonce: nonce },
          app_metadata: { driver_username_managed: true, driver_access_tenant_id: tenantId },
        });
        if (error) {
          if (error.code === 'email_exists' || /already.*registered|already exists/i.test(error.message)) {
            throw new AccessError('Este usuário já está em uso. Escolha outro usuário.', 409);
          }
          throw new AccessError('Não foi possível criar a conta de motorista.', 409);
        }
        if (!data.user) throw new AccessError('O serviço não confirmou a criação da conta.', 503);
        return json({ success: true, user_id: data.user.id, username: driverUsernameFromEmail(email) });
      } finally {
        // A failed creation must not leave a reusable authorization. The nonce is never returned.
        await admin.rpc('cancel_auth_invite', { _email: email, _nonce: nonce });
      }
    }
    if (!userId) throw new AccessError('Conta de motorista não encontrada.', 404);
    if (body.action === 'retire_legacy') {
      // Revoke relational access before deleting Auth: existing JWTs can otherwise outlive deletion.
      await getScope(userId, true);
      const { error } = await admin.auth.admin.deleteUser(userId, true);
      if (error) throw new AccessError('O acesso foi desativado, mas a exclusão da conta precisa ser tentada novamente.', 503);
      return json({ success: true });
    }
    const scope = await getScope(userId);
    if (!scope.managed || scope.tenant_id !== tenantId || scope.retired || scope.deleted || !scope.active || !driverUsernameFromEmail(scope.email)) {
      throw new AccessError('Exclua a conta antiga e crie uma nova conta por usuário antes de trocar a senha.', 409);
    }
    if (typeof body.password !== 'string') throw new AccessError('Informe a nova senha.');
    validateDriverPassword(body.password);
    const { error } = await admin.auth.admin.updateUserById(userId, { password: body.password });
    if (error) throw new AccessError('Não foi possível trocar a senha.', 503);
    return json({ success: true });
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.message }, error.status);
    // Never echo request bodies, passwords, nonces, or upstream Auth diagnostics.
    return json({ error: error instanceof Error && /Use (um usuário|uma senha)/.test(error.message) ? error.message : 'Não foi possível concluir a operação.' }, 400);
  }
}
