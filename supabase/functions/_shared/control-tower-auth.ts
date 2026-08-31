import type { SupabaseClient } from '@supabase/supabase-js';

/** Caller JWT only: service credentials must not authorize operational writes. */
export async function canManageControlTower(client: SupabaseClient, tenant: string, actor: string) {
  const {data:membership,error} = await client.from('tenant_memberships').select('role')
    .eq('tenant_id',tenant).eq('user_id',actor).eq('active',true).maybeSingle();
  if(error || !membership || !['owner','admin','operator'].includes(membership.role)) return false;
  if(['owner','admin'].includes(membership.role)) {
    const assurance=await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if(assurance.error || assurance.data?.currentLevel!=='aal2') return false;
  }
  const permission=await client.rpc('is_tenant_operator_or_admin',{_tenant_id:tenant});
  return !permission.error && permission.data===true;
}
