create or replace function finance_private.maintenance_order_civil_year(
  _tenant_id uuid,
  _at timestamptz default clock_timestamp()
)
returns integer
language sql
stable
security definer
set search_path=''
as $function$
  select extract(year from timezone(tenant.timezone,_at))::integer
  from public.tenants tenant
  where tenant.id=_tenant_id
$function$;
revoke all on function finance_private.maintenance_order_civil_year(uuid,timestamptz)
from public,anon,authenticated,service_role;

create or replace function finance_private.next_maintenance_order_number(_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_value bigint;
  v_year integer;
begin
  v_year:=finance_private.maintenance_order_civil_year(_tenant_id,clock_timestamp());
  if v_year is null then
    raise exception 'maintenance_order_tenant_not_found' using errcode='23503';
  end if;

  insert into finance_private.maintenance_order_sequences(tenant_id,next_number)
  values(_tenant_id,2)
  on conflict(tenant_id) do update
  set next_number=finance_private.maintenance_order_sequences.next_number+1
  returning next_number-1 into v_value;

  return 'OS-'||v_year::text||'-'||lpad(v_value::text,6,'0');
end;
$function$;
revoke all on function finance_private.next_maintenance_order_number(uuid)
from public,anon,authenticated,service_role;

comment on function finance_private.maintenance_order_civil_year(uuid,timestamptz) is
  'Returns the maintenance order year from the tenant civil timezone at the supplied instant.';
comment on function finance_private.next_maintenance_order_number(uuid) is
  'Allocates a monotonic tenant suffix and prefixes it with the tenant-local civil year.';
