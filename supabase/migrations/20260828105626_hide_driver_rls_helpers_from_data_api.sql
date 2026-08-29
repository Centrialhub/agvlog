create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter function public._driver_client_ids() set schema private;
alter function public._driver_fiscal_document_ids() set schema private;
alter function public._driver_load_ids() set schema private;
alter function public._driver_order_ids() set schema private;
alter function public._driver_pickup_order_ids() set schema private;
alter function public._driver_trip_ids() set schema private;

create or replace function private._driver_load_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select distinct dtl.load_id
  from public.dispatch_trip_loads dtl
  join public.dispatch_trips dt on dt.id = dtl.dispatch_trip_id
  join public.drivers d on d.id = dt.driver_id
  join public.loads l on l.id = dtl.load_id
  where d.user_id = auth.uid() and d.active = true and l.on_hold = false
  union
  select l.id
  from public.loads l
  join public.dispatch_trips dt on dt.id = l.trip_id
  join public.drivers d on d.id = dt.driver_id
  where d.user_id = auth.uid() and d.active = true and l.on_hold = false
  union
  select l.id
  from public.loads l
  join public.drivers d on d.id = l.driver_id
  where d.user_id = auth.uid() and d.active = true and l.on_hold = false;
$function$;

create or replace function private._driver_order_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select distinct lo.order_id
  from public.load_orders lo
  where lo.load_id in (select private._driver_load_ids());
$function$;

create or replace function private._driver_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select distinct client_id
  from public.fiscal_documents
  where load_id in (select private._driver_load_ids()) and client_id is not null
  union
  select distinct client_id
  from public.orders
  where id in (select private._driver_order_ids()) and client_id is not null;
$function$;

create or replace function private._driver_fiscal_document_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select id
  from public.fiscal_documents
  where load_id in (select private._driver_load_ids());
$function$;

create or replace function private._driver_pickup_order_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select distinct pickup_order_id
  from public.fiscal_documents
  where load_id in (select private._driver_load_ids()) and pickup_order_id is not null;
$function$;

create or replace function private._driver_trip_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select t.id
  from public.dispatch_trips t
  join public.drivers d on d.id = t.driver_id
  where d.user_id = auth.uid() and d.active = true;
$function$;

revoke execute on function private._driver_client_ids() from public, anon;
revoke execute on function private._driver_fiscal_document_ids() from public, anon;
revoke execute on function private._driver_load_ids() from public, anon;
revoke execute on function private._driver_order_ids() from public, anon;
revoke execute on function private._driver_pickup_order_ids() from public, anon;
revoke execute on function private._driver_trip_ids() from public, anon;

grant execute on function private._driver_client_ids(),
                          private._driver_fiscal_document_ids(),
                          private._driver_load_ids(),
                          private._driver_order_ids(),
                          private._driver_pickup_order_ids(),
                          private._driver_trip_ids()
to authenticated, service_role;
