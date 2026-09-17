drop function public.list_trip_cargo_controls_v2(uuid,text,integer,integer);
create function public.list_trip_cargo_controls_v2(
  _tenant_id uuid,
  _status text default null,
  _page integer default 1,
  _page_size integer default 50,
  _expected_revision text default null
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare
  v_page integer:=greatest(coalesce(_page,1),1);
  v_page_size integer:=least(greatest(coalesce(_page_size,50),1),100);
  v_total integer;v_items jsonb;v_revision text;
begin
  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id
    or not exists(select 1 from public.tenant_memberships membership where membership.tenant_id=_tenant_id and membership.user_id=auth.uid() and membership.active and membership.role in('owner','admin','operator')) then
    raise exception 'trip_cargo_not_authorized' using errcode='42501';
  end if;
  if _status is not null and _status not in('pending_acceptance','accepted','loading','ready_to_depart','departed','returned','closed') then raise exception 'trip_cargo_status_invalid' using errcode='22023';end if;
  if _expected_revision is not null and _expected_revision!~'^[a-f0-9]{32}$' then raise exception 'trip_cargo_list_revision_invalid' using errcode='22023';end if;

  with base as materialized(
    select control.id,control.dispatch_trip_id trip_id,control.driver_id,control.vehicle_id,control.status,control.updated_at,
      (select count(*) from public.trip_cargo_divergences divergence where divergence.control_id=control.id and divergence.status in('pending','rejected')) pending_divergences,
      (select count(*) from public.delivery_receipts receipt where receipt.tenant_id=_tenant_id and receipt.dispatch_trip_id=control.dispatch_trip_id and receipt.is_active and receipt.physical_status<>'received') pending_physical_receipts
    from public.trip_cargo_controls control
    where control.tenant_id=_tenant_id and (_status is null or control.status=_status)
  ), summary as(
    select count(*)::integer total_count,md5(coalesce(string_agg(md5(to_jsonb(base)::text),'' order by base.id),'empty')) revision from base
  ), page_rows as(
    select * from base order by updated_at desc,id desc limit v_page_size offset ((v_page-1)*v_page_size)
  )
  select summary.total_count,summary.revision,coalesce((select jsonb_agg(to_jsonb(row) order by row.updated_at desc,row.id desc) from page_rows row),'[]'::jsonb)
  into v_total,v_revision,v_items from summary;

  if _expected_revision is not null and _expected_revision<>v_revision then raise exception 'trip_cargo_list_changed' using errcode='40001';end if;
  return jsonb_build_object('version',2,'tenant_id',_tenant_id,'items',v_items,'total_count',v_total,'page',v_page,'page_size',v_page_size,'revision',v_revision);
end
$function$;
revoke all on function public.list_trip_cargo_controls_v2(uuid,text,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.list_trip_cargo_controls_v2(uuid,text,integer,integer,text) to authenticated,service_role;
