create table if not exists private.delivery_receipt_filter_option_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  actor_id uuid not null,
  kind text not null,
  search text not null,
  items jsonb not null check (jsonb_typeof(items)='array'),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists delivery_receipt_filter_option_snapshots_expiry_idx
  on private.delivery_receipt_filter_option_snapshots(created_at);
revoke all on table private.delivery_receipt_filter_option_snapshots
  from public, anon, authenticated, service_role;

create or replace function public.list_delivery_receipt_filter_options_v1(
  _tenant_id uuid,
  _kind text,
  _search text default null,
  _limit integer default 25,
  _cursor_label text default null,
  _cursor_value text default null,
  _snapshot_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare
  v_actor uuid:=auth.uid();
  v_search text:=coalesce(nullif(btrim(_search),''),'');
  v_pattern text;
  v_snapshot private.delivery_receipt_filter_option_snapshots%rowtype;
  v_items jsonb;
  v_result jsonb;
begin
  if v_actor is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_not_authorized' using errcode='42501';
  end if;
  if _kind not in('driver','vehicle','supplier','trip','load','client','city','state')
    or _limit<1 or _limit>50
    or ((_cursor_label is null)<>(_cursor_value is null))
    or (_cursor_label is not null and _snapshot_id is null) then
    raise exception 'invalid_delivery_receipt_filter_page' using errcode='22023';
  end if;
  if v_search<>'' then
    v_pattern:='%'||replace(replace(replace(v_search,chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_')||'%';
  end if;

  if _snapshot_id is null then
    delete from private.delivery_receipt_filter_option_snapshots snapshot
    where snapshot.actor_id=v_actor and snapshot.created_at<clock_timestamp()-interval '1 hour';
    select coalesce(jsonb_agg(jsonb_build_object('value',option.value,'label',option.label)
      order by lower(option.label),option.value),'[]'::jsonb)
    into v_items
    from private.delivery_receipt_filter_options(_tenant_id,_kind) option
    where v_pattern is null or option.label ilike v_pattern escape E'\\'
      or option.value ilike v_pattern escape E'\\';
    insert into private.delivery_receipt_filter_option_snapshots(tenant_id,actor_id,kind,search,items)
    values(_tenant_id,v_actor,_kind,v_search,v_items)
    returning * into v_snapshot;
  else
    select snapshot.* into v_snapshot
    from private.delivery_receipt_filter_option_snapshots snapshot
    where snapshot.id=_snapshot_id and snapshot.tenant_id=_tenant_id and snapshot.actor_id=v_actor
      and snapshot.kind=_kind and snapshot.search=v_search
      and snapshot.created_at>=clock_timestamp()-interval '1 hour';
    if not found then
      raise exception 'delivery_receipt_filter_snapshot_expired' using errcode='22023';
    end if;
    v_items:=v_snapshot.items;
  end if;

  with matching as materialized (
    select item->>'value' value,item->>'label' label
    from jsonb_array_elements(v_items) item
  ), candidates as materialized (
    select matching.value,matching.label
    from matching
    where _cursor_label is null
      or (lower(matching.label),matching.value)>(lower(_cursor_label),_cursor_value)
    order by lower(matching.label),matching.value
    limit _limit+1
  ), visible as materialized (
    select candidates.value,candidates.label from candidates
    order by lower(candidates.label),candidates.value limit _limit
  ), continuation as (
    select visible.label,visible.value from visible
    order by lower(visible.label) desc,visible.value desc limit 1
  )
  select jsonb_build_object(
    'version',1,'tenant_id',_tenant_id,'actor_id',v_actor,'kind',_kind,'search',v_search,
    'snapshot_id',v_snapshot.id,
    'items',coalesce((select jsonb_agg(jsonb_build_object('value',value,'label',label)
      order by lower(label),value) from visible),'[]'::jsonb),
    'has_more',(select count(*) from candidates)>_limit,
    'next_cursor_label',case when (select count(*) from candidates)>_limit then (select label from continuation) end,
    'next_cursor_value',case when (select count(*) from candidates)>_limit then (select value from continuation) end
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.list_delivery_receipt_filter_options_v1(uuid,text,text,integer,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.list_delivery_receipt_filter_options_v1(uuid,text,text,integer,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.list_delivery_receipt_filter_options_v1(uuid,text,text,integer,text,text,uuid)
  to authenticated,service_role;

comment on function public.list_delivery_receipt_filter_options_v1(uuid,text,text,integer,text,text,uuid) is
  'Searches a frozen receipt-filter catalog and requires its snapshot on continuation pages.';
