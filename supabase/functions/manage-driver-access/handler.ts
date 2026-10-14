import type { SupabaseClient } from '@supabase/supabase-js';
import { requireActiveTenant } from '../_shared/active-tenant.ts';
import { driverLoginEmail, driverUsernameFromEmail, validateDriverPassword } from '../_shared/driverCredentials.ts';
import { handleWorkspaceCredentialCommand } from './workspace-credentials.ts';

type Scope = { managed: boolean; retired: boolean; deleted: boolean; active: boolean; email: string; tenant_id: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class AccessError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) { super(message); }
}
const scopeMessage = 'Conta compartilhada com outra empresa ou outro perfil. A gestão desta conta de acesso está bloqueada para proteger os demais vínculos. O cadastro do motorista é separado; não exclua nem desvincule registros para contornar este bloqueio.';

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
    if (!body || !uuid.test(body.tenant_id ?? '') || !['inspect', 'create', 'password', 'convert', 'credential_status', 'legacy_list', 'retire_legacy'].includes(body.action)) {
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
        if (error.message.includes('shared_or_other_role')) throw new AccessError(scopeMessage, 409, 'account_scope_restricted');
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
      if (['convert', 'password', 'credential_status'].includes(body.action) && body.user_id !== undefined
        && body.user_id !== driver.user_id) throw new AccessError('O vínculo de acesso mudou. Atualize o cadastro.', 409);
      userId = driver.user_id;
    }
    if (body.action === 'inspect') {
      if (body.version === 2 || body.version === 3) {
        // Local visibility and global identity administration are different capabilities.
        // Establish a LOCAL link before classifying any scope refusal; never use a global
        // account error as an existence oracle for an arbitrary user_id.
        let localMembership: { role: string; active: boolean } | null = null;
        if (userId) {
          const member = await admin.from('tenant_memberships').select('role,active')
            .eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
          if (member.error) throw new AccessError('Não foi possível consultar o vínculo desta empresa.', 503);
          localMembership = member.data;
          if (!driver) {
            const registry = await admin.from('drivers').select('id,name,user_id,active')
              .eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
            if (registry.error) throw new AccessError('Não foi possível consultar o cadastro desta empresa.', 503);
            driver = registry.data;
          }
        }
        if (!driver && localMembership?.role !== 'driver') throw new AccessError('Vínculo de motorista não encontrado nesta empresa.', 404);
        const capabilities = { create_access: false, change_password: false, change_identity: false, delete_identity: false, unlink: false };
        if (!userId) return json({ version: body.version, kind: 'none', driver_id: driver!.id, username: null,
          active: false, capabilities: { ...capabilities, create_access: driver!.active } });
        if (body.version === 3) {
          const result = await admin.rpc('inspect_driver_workspace_credentials_v1', {
            _tenant_id: tenantId, _actor_id: caller.id, _user_id: userId,
          });
          if (result.error) {
            if (!/driver_credential_(scope_restricted|forbidden)/.test(result.error.message))
              throw new AccessError('Não foi possível confirmar as permissões de credenciais.', 503);
            return json({ version: 3, kind: 'linked', driver_id: driver?.id ?? null, username: null,
              active: localMembership?.active === true, capabilities, credential_management: 'unavailable' });
          }
          if (!result.data || typeof result.data.managed !== 'boolean') throw new AccessError('O serviço não confirmou o acesso.', 503);
          const username = result.data.managed ? driverUsernameFromEmail(result.data.email) : null;
          const pending = result.data.command_pending === true;
          return json({ version: 3, kind: result.data.managed ? 'managed' : 'legacy', driver_id: driver?.id ?? null,
            username, active: true, command_pending: pending, pending_request_id: result.data.pending_request_id ?? null,
            capabilities: { ...capabilities, change_password: !pending && !!username,
              change_identity: !pending && !result.data.managed } });
        }
        let scope: Scope;
        try { scope = await getScope(userId); }
        catch (error) {
          if (!(error instanceof AccessError) || error.code !== 'account_scope_restricted') throw error;
          return json({ version: 2, kind: 'linked', driver_id: driver?.id ?? null, username: null,
            active: localMembership?.active === true, capabilities,
            credential_management: 'unavailable' });
        }
        const managed = scope.managed && scope.tenant_id === tenantId && !scope.retired && !scope.deleted;
        const username = managed ? driverUsernameFromEmail(scope.email) : null;
        return json({ version: 2, kind: managed ? 'managed' : 'legacy', driver_id: driver?.id ?? null,
          username, active: scope.active,
          capabilities: { ...capabilities, change_password: !!(managed && scope.active && username) } });
      }
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
    if (['convert', 'password', 'credential_status'].includes(body.action)) {
      if (!uuid.test(body.request_id ?? '')) throw new AccessError('Atualize a tela para iniciar uma solicitação de credenciais identificada.', 409);
      const result = await handleWorkspaceCredentialCommand(admin, { tenantId, actorId: caller.id, userId,
        requestId: body.request_id.toLowerCase(), action: body.action, driverId: driver?.id,
        username: body.username, password: body.password });
      return json(result.body, result.status);
    }
    if (body.action === 'retire_legacy') {
      // Revoke relational access before deleting Auth: existing JWTs can otherwise outlive deletion.
      await getScope(userId, true);
      const { error } = await admin.auth.admin.deleteUser(userId, true);
      if (error) throw new AccessError('O acesso foi desativado, mas a exclusão da conta precisa ser tentada novamente.', 503);
      return json({ success: true });
    }
    throw new AccessError('Solicitação inválida.');
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.message }, error.status);
    // Never echo request bodies, passwords, nonces, or upstream Auth diagnostics.
    return json({ error: error instanceof Error && /Use (um usuário|uma senha)/.test(error.message) ? error.message : 'Não foi possível concluir a operação.' }, 400);
  }
}
