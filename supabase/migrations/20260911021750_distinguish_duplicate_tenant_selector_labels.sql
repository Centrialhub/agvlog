create or replace function public.get_current_memberships_v1()
returns table (
  tenant_id uuid,
  role public.app_role,
  tenant_name text,
  plan_key text,
  timezone text
)
language sql
stable
security definer
set search_path = ''
as $function$
  with company_names as (
    select
      tenant.id,
      tenant.workspace_id,
      tenant.plan_key,
      tenant.timezone,
      tenant.created_at,
      coalesce(
        nullif(btrim(tenant.settings #>> '{company,trade_name}'), ''),
        nullif(btrim(tenant.settings #>> '{company,legal_name}'), ''),
        tenant.name
      ) as company_name
    from public.tenants tenant
  ),
  selector_labels as (
    select
      company.*,
      case
        when count(*) over (
          partition by company.workspace_id, lower(company.company_name)
        ) > 1
        then company.company_name || ' · Empresa ' ||
          row_number() over (
            partition by company.workspace_id, lower(company.company_name)
            order by company.created_at, company.id
          )::text
        else company.company_name
      end as selector_label
    from company_names company
  )
  select
    membership.tenant_id,
    membership.role,
    company.selector_label as tenant_name,
    company.plan_key,
    company.timezone
  from public.tenant_memberships membership
  join selector_labels company on company.id = membership.tenant_id
  where membership.user_id = auth.uid()
    and membership.active
  order by company.created_at, company.id;
$function$;

revoke all on function public.get_current_memberships_v1()
from public, anon, authenticated, service_role;
grant execute on function public.get_current_memberships_v1()
to authenticated, service_role;

comment on function public.get_current_memberships_v1() is
  'Returns per-user tenant choices using company names and stable ordinal suffixes only while registrations still share the same display name.';
