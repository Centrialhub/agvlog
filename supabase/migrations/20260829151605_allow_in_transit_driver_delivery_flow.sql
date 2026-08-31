create or replace function public._assert_driver_owns_trip(_trip_id uuid)
returns table(driver_id uuid, tenant_id uuid, status text)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_driver uuid;
  v_tenant uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select t.driver_id, t.tenant_id, t.status
    into v_driver, v_tenant, v_status
  from public.dispatch_trips t
  where t.id = _trip_id;

  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.drivers d
    where d.id = v_driver
      and d.user_id = v_uid
      and d.tenant_id = v_tenant
      and d.active = true
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if v_status not in (
    'planned',
    'loading',
    'dispatched',
    'in_progress',
    'in_transit',
    'completed'
  ) then
    raise exception 'trip_not_active' using errcode = '22023';
  end if;

  driver_id := v_driver;
  tenant_id := v_tenant;
  status := v_status;
  return next;
end;
$function$;

comment on function public._assert_driver_owns_trip(uuid)
  is 'Validates that the authenticated active driver owns a trip in a canonical active or completed state.';
