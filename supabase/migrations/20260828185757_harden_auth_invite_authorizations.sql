create index auth_invite_authorizations_tenant_id_idx
  on private.auth_invite_authorizations (tenant_id);

create index auth_invite_authorizations_invited_by_idx
  on private.auth_invite_authorizations (invited_by);

create policy auth_invite_authorizations_deny_client_access
on private.auth_invite_authorizations
as restrictive
for all
to anon, authenticated
using (false)
with check (false);
