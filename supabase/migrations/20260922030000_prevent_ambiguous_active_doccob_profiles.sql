set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.guard_unique_active_doccob_profile()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if not new.enabled then return new; end if;

  -- The transaction lock closes the race between the existence check and the
  -- write without forcing a migration-time cleanup of legacy duplicates.
  perform pg_advisory_xact_lock(hashtextextended(
    new.tenant_id::text || ':' || coalesce(new.client_id::text, 'global'), 0
  ));
  if exists (
    select 1
    from public.billing_edi_profiles profile
    where profile.tenant_id = new.tenant_id
      and profile.client_id is not distinct from new.client_id
      and profile.enabled
      and profile.id is distinct from new.id
  ) then
    raise exception 'doccob_active_profile_ambiguous' using errcode = '23505';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_unique_active_doccob_profile()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_unique_active_doccob_profile on public.billing_edi_profiles;
create trigger guard_unique_active_doccob_profile
before insert or update of tenant_id, client_id, enabled on public.billing_edi_profiles
for each row execute function public.guard_unique_active_doccob_profile();

comment on function public.guard_unique_active_doccob_profile() is
  'Serializes each tenant/client profile scope and prevents more than one enabled DOCCOB profile; legacy duplicates remain visible for explicit resolution.';
