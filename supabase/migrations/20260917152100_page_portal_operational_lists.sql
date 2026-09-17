create or replace function public.list_client_pickups_page_v1(
  _tenant_id uuid,
  _client_id uuid default null,
  _status text default null,
  _start_date timestamptz default null,
  _end_date timestamptz default null,
  _page_size integer default 50,
  _snapshot_at timestamptz default null,
  _cursor jsonb default null,
  _expected_revision text default null
) returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare
  v_snapshot timestamptz := coalesce(_snapshot_at, statement_timestamp());
  v_limit integer := least(greatest(coalesce(_page_size, 50), 1), 100);
  v_revision text;
  v_rows jsonb;
  v_next jsonb;
begin
  perform public._portal_assert_client_access(_tenant_id, _client_id);

  select md5(count(*)::text || ':' || coalesce(max(p.updated_at)::text, '') || ':' || coalesce(max(p.created_at)::text, ''))
  into v_revision
  from public.pickup_orders p
  where p.tenant_id = _tenant_id
    and p.created_at <= v_snapshot
    and public.portal_user_can_access_pickup_order(_tenant_id, p.id)
    and (_client_id is null or p.remitter_client_id = _client_id)
    and (_status is null or p.status = _status)
    and (_start_date is null or p.pickup_at >= _start_date)
    and (_end_date is null or p.pickup_at <= _end_date);

  if _expected_revision is not null and _expected_revision <> v_revision then
    raise exception 'portal_list_snapshot_changed' using errcode='40001';
  end if;

  with page as materialized (
    select p.id, p.pickup_number, p.remitter_name, p.remitter_cnpj, p.recipient_name,
      p.pickup_at, p.status, p.notes,
      (select count(*) from public.fiscal_documents fd where fd.pickup_order_id = p.id) as linked_docs_count,
      coalesce(p.pickup_at, '-infinity'::timestamptz) as sort_pickup_at,
      p.created_at as sort_created_at
    from public.pickup_orders p
    where p.tenant_id = _tenant_id
      and p.created_at <= v_snapshot
      and public.portal_user_can_access_pickup_order(_tenant_id, p.id)
      and (_client_id is null or p.remitter_client_id = _client_id)
      and (_status is null or p.status = _status)
      and (_start_date is null or p.pickup_at >= _start_date)
      and (_end_date is null or p.pickup_at <= _end_date)
      and (
        _cursor is null
        or (coalesce(p.pickup_at, '-infinity'::timestamptz), p.created_at, p.id)
          < ((_cursor->>'pickup_at')::timestamptz, (_cursor->>'created_at')::timestamptz, (_cursor->>'id')::uuid)
      )
    order by sort_pickup_at desc, sort_created_at desc, p.id desc
    limit v_limit + 1
  ), visible as (
    select * from page
    order by sort_pickup_at desc, sort_created_at desc, id desc
    limit v_limit
  )
  select
    coalesce((select jsonb_agg(to_jsonb(v) - 'sort_pickup_at' - 'sort_created_at'
      order by v.sort_pickup_at desc, v.sort_created_at desc, v.id desc) from visible v), '[]'::jsonb),
    case when (select count(*) from page) > v_limit then (
      select jsonb_build_object('pickup_at', v.sort_pickup_at, 'created_at', v.sort_created_at, 'id', v.id)
      from visible v order by v.sort_pickup_at, v.sort_created_at, v.id limit 1
    ) end
  into v_rows, v_next;

  return jsonb_build_object('rows', v_rows, 'next_cursor', v_next, 'snapshot_at', v_snapshot, 'revision', v_revision);
end;
$function$;

create or replace function public.list_client_pods_page_v1(
  _tenant_id uuid,
  _client_id uuid default null,
  _status text default null,
  _start_date timestamptz default null,
  _end_date timestamptz default null,
  _page_size integer default 50,
  _snapshot_at timestamptz default null,
  _cursor jsonb default null,
  _expected_revision text default null
) returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare
  v_snapshot timestamptz := coalesce(_snapshot_at, statement_timestamp());
  v_limit integer := least(greatest(coalesce(_page_size, 50), 1), 100);
  v_revision text;
  v_rows jsonb;
  v_next jsonb;
begin
  perform public._portal_assert_client_access(_tenant_id, _client_id);

  select md5(count(*)::text || ':' || coalesce(max(pod.updated_at)::text, '') || ':' || coalesce(max(pod.created_at)::text, ''))
  into v_revision
  from public.current_delivery_proofs pod
  join public.fiscal_documents fd on fd.id = pod.fiscal_document_id
  where pod.tenant_id = _tenant_id
    and pod.created_at <= v_snapshot
    and public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
    and (_client_id is null or fd.client_id = _client_id)
    and (_status is null or pod.status = _status)
    and (_start_date is null or pod.received_at >= _start_date)
    and (_end_date is null or pod.received_at <= _end_date);

  if _expected_revision is not null and _expected_revision <> v_revision then
    raise exception 'portal_list_snapshot_changed' using errcode='40001';
  end if;

  with page as materialized (
    select pod.id, pod.fiscal_document_id, pod.load_id, fd.invoice_number,
      pod.proof_type, pod.status, (pod.storage_path is not null) as has_file,
      pod.receiver_name, pod.receiver_document, pod.receiver_role,
      pod.received_at, pod.validated_at,
      coalesce(pod.received_at, '-infinity'::timestamptz) as sort_received_at,
      pod.created_at as sort_created_at
    from public.current_delivery_proofs pod
    join public.fiscal_documents fd on fd.id = pod.fiscal_document_id
    where pod.tenant_id = _tenant_id
      and pod.created_at <= v_snapshot
      and public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
      and (_client_id is null or fd.client_id = _client_id)
      and (_status is null or pod.status = _status)
      and (_start_date is null or pod.received_at >= _start_date)
      and (_end_date is null or pod.received_at <= _end_date)
      and (
        _cursor is null
        or (coalesce(pod.received_at, '-infinity'::timestamptz), pod.created_at, pod.id)
          < ((_cursor->>'received_at')::timestamptz, (_cursor->>'created_at')::timestamptz, (_cursor->>'id')::uuid)
      )
    order by sort_received_at desc, sort_created_at desc, pod.id desc
    limit v_limit + 1
  ), visible as (
    select * from page
    order by sort_received_at desc, sort_created_at desc, id desc
    limit v_limit
  )
  select
    coalesce((select jsonb_agg(to_jsonb(v) - 'sort_received_at' - 'sort_created_at'
      order by v.sort_received_at desc, v.sort_created_at desc, v.id desc) from visible v), '[]'::jsonb),
    case when (select count(*) from page) > v_limit then (
      select jsonb_build_object('received_at', v.sort_received_at, 'created_at', v.sort_created_at, 'id', v.id)
      from visible v order by v.sort_received_at, v.sort_created_at, v.id limit 1
    ) end
  into v_rows, v_next;

  return jsonb_build_object('rows', v_rows, 'next_cursor', v_next, 'snapshot_at', v_snapshot, 'revision', v_revision);
end;
$function$;

create or replace function public.list_client_occurrences_page_v1(
  _tenant_id uuid,
  _client_id uuid default null,
  _severity text default null,
  _resolved boolean default null,
  _page_size integer default 50,
  _snapshot_at timestamptz default null,
  _cursor jsonb default null,
  _expected_revision text default null
) returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare
  v_snapshot timestamptz := coalesce(_snapshot_at, statement_timestamp());
  v_limit integer := least(greatest(coalesce(_page_size, 50), 1), 100);
  v_revision text;
  v_rows jsonb;
  v_next jsonb;
begin
  perform public._portal_assert_client_access(_tenant_id, _client_id);

  with allowed as (select unnest(public._portal_user_client_ids(_tenant_id)) as client_id)
  select md5(count(*)::text || ':' || coalesce(max(oe.updated_at)::text, '') || ':' || coalesce(max(oe.created_at)::text, ''))
  into v_revision
  from public.operational_events oe
  where oe.tenant_id = _tenant_id
    and oe.created_at <= v_snapshot
    and oe.client_id in (select client_id from allowed)
    and (_client_id is null or oe.client_id = _client_id)
    and (oe.visible_to_client = true or oe.client_opened = true)
    and (_severity is null or oe.severity = _severity)
    and (_resolved is null or (_resolved and oe.resolved_at is not null) or (not _resolved and oe.resolved_at is null));

  if _expected_revision is not null and _expected_revision <> v_revision then
    raise exception 'portal_list_snapshot_changed' using errcode='40001';
  end if;

  with allowed as materialized (
    select unnest(public._portal_user_client_ids(_tenant_id)) as client_id
  ), page as materialized (
    select oe.id, oe.load_id, oe.order_id, oe.event_type, oe.severity, oe.description,
      oe.public_status, oe.client_action_required, oe.client_opened,
      oe.client_resolution_note, oe.resolution, oe.resolved_at, oe.created_at
    from public.operational_events oe
    where oe.tenant_id = _tenant_id
      and oe.created_at <= v_snapshot
      and oe.client_id in (select client_id from allowed)
      and (_client_id is null or oe.client_id = _client_id)
      and (oe.visible_to_client = true or oe.client_opened = true)
      and (_severity is null or oe.severity = _severity)
      and (_resolved is null or (_resolved and oe.resolved_at is not null) or (not _resolved and oe.resolved_at is null))
      and (
        _cursor is null
        or (oe.created_at, oe.id) < ((_cursor->>'created_at')::timestamptz, (_cursor->>'id')::uuid)
      )
    order by oe.created_at desc, oe.id desc
    limit v_limit + 1
  ), visible as (
    select * from page order by created_at desc, id desc limit v_limit
  )
  select
    coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc, v.id desc) from visible v), '[]'::jsonb),
    case when (select count(*) from page) > v_limit then (
      select jsonb_build_object('created_at', v.created_at, 'id', v.id)
      from visible v order by v.created_at, v.id limit 1
    ) end
  into v_rows, v_next;

  return jsonb_build_object('rows', v_rows, 'next_cursor', v_next, 'snapshot_at', v_snapshot, 'revision', v_revision);
end;
$function$;

revoke all on function public.list_client_pickups_page_v1(uuid,uuid,text,timestamptz,timestamptz,integer,timestamptz,jsonb,text),
  public.list_client_pods_page_v1(uuid,uuid,text,timestamptz,timestamptz,integer,timestamptz,jsonb,text),
  public.list_client_occurrences_page_v1(uuid,uuid,text,boolean,integer,timestamptz,jsonb,text)
from public, anon, authenticated, service_role;

grant execute on function public.list_client_pickups_page_v1(uuid,uuid,text,timestamptz,timestamptz,integer,timestamptz,jsonb,text),
  public.list_client_pods_page_v1(uuid,uuid,text,timestamptz,timestamptz,integer,timestamptz,jsonb,text),
  public.list_client_occurrences_page_v1(uuid,uuid,text,boolean,integer,timestamptz,jsonb,text)
to authenticated, service_role;
