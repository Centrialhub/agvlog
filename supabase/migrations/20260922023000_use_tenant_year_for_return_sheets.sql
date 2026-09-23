create or replace function public.next_occurrence_return_sheet_number(
  _tenant_id uuid,
  _date date default current_date
) returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_timezone text;
  v_local_date date;
  v_year integer;
  v_next integer;
begin
  if not public.is_tenant_member(_tenant_id) then
    raise exception 'not authorized for tenant';
  end if;
  select case
    when exists(
      select 1 from pg_catalog.pg_timezone_names zone where zone.name=tenant.timezone
    ) then tenant.timezone
    else 'America/Sao_Paulo'
  end into v_timezone
  from public.tenants tenant
  where tenant.id=_tenant_id;
  if not found then raise exception 'tenant_not_found' using errcode='P0002';end if;
  v_local_date:=(statement_timestamp() at time zone v_timezone)::date;
  v_year:=extract(year from v_local_date)::integer;
  insert into public.occurrence_return_sheet_sequences(tenant_id,sequence_year,next_number)
  values(_tenant_id,v_year,2)
  on conflict(tenant_id,sequence_year) do update
    set next_number=public.occurrence_return_sheet_sequences.next_number+1,
        updated_at=now()
  returning next_number-1 into v_next;
  return 'SAC-'||v_year::text||'-'||lpad(v_next::text,4,'0');
end;
$function$;

comment on function public.next_occurrence_return_sheet_number(uuid,date) is
  'Allocates the current annual return-sheet sequence in the tenant civil timezone. The date argument is retained only for ABI compatibility.';
