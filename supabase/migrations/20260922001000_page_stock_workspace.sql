create index if not exists stock_items_tenant_name_id_idx
  on public.stock_items (tenant_id, name, id);
create index if not exists stock_movements_tenant_moved_id_idx
  on public.stock_movements (tenant_id, moved_at desc, id);

create or replace function public.stock_items_page_v1(
  _tenant_id uuid,
  _search text default null,
  _category text default null,
  _availability text default null,
  _limit integer default 50,
  _offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare v_rows jsonb; v_total integer;
begin
  if auth.uid() is null or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'operator_required' using errcode='42501';
  end if;
  if _limit < 1 or _limit > 100 or _offset < 0 then
    raise exception 'invalid_pagination' using errcode='22023';
  end if;
  with scoped as materialized (
    select item.*
    from public.stock_items item
    where item.tenant_id = _tenant_id
      and (nullif(btrim(_search),'') is null or concat_ws(' ',item.name,item.code,item.supplier,item.location) ilike '%'||btrim(_search)||'%')
      and (nullif(_category,'') is null or item.category = _category)
      and (nullif(_availability,'') is null
        or (_availability='empty' and coalesce(item.current_quantity,0)<=0)
        or (_availability='low' and coalesce(item.min_quantity,0)>0 and coalesce(item.current_quantity,0)<=item.min_quantity))
  ), page as (
    select * from scoped order by name,id limit _limit offset _offset
  )
  select coalesce(jsonb_agg(to_jsonb(page) order by name,id),'[]'::jsonb),
         (select count(*)::integer from scoped)
  into v_rows,v_total from page;
  return jsonb_build_object('rows',v_rows,'total',v_total);
end;
$function$;

create or replace function public.stock_movements_page_v1(
  _tenant_id uuid,
  _search text default null,
  _movement_type text default null,
  _from timestamptz default null,
  _to_exclusive timestamptz default null,
  _limit integer default 50,
  _offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare v_rows jsonb; v_total integer;
begin
  if auth.uid() is null or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'operator_required' using errcode='42501';
  end if;
  if _limit < 1 or _limit > 100 or _offset < 0 then
    raise exception 'invalid_pagination' using errcode='22023';
  end if;
  with scoped as materialized (
    select movement.*,
      jsonb_build_object('name',item.name,'unit',item.unit) as stock_items,
      case when employee.id is null then null else jsonb_build_object('name',employee.name) end as employees
    from public.stock_movements movement
    join public.stock_items item on item.tenant_id=movement.tenant_id and item.id=movement.stock_item_id
    left join public.employees employee on employee.tenant_id=movement.tenant_id and employee.id=movement.responsible_employee_id
    where movement.tenant_id=_tenant_id
      and (nullif(btrim(_search),'') is null or concat_ws(' ',item.name,movement.reason,employee.name) ilike '%'||btrim(_search)||'%')
      and (nullif(_movement_type,'') is null or movement.movement_type=_movement_type)
      and (_from is null or movement.moved_at>=_from)
      and (_to_exclusive is null or movement.moved_at<_to_exclusive)
  ), page as (
    select * from scoped order by moved_at desc,id limit _limit offset _offset
  )
  select coalesce(jsonb_agg(to_jsonb(page) order by moved_at desc,id),'[]'::jsonb),
         (select count(*)::integer from scoped)
  into v_rows,v_total from page;
  return jsonb_build_object('rows',v_rows,'total',v_total);
end;
$function$;

create or replace function public.stock_workspace_metrics_v1(_tenant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
begin
  if auth.uid() is null or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'operator_required' using errcode='42501';
  end if;
  return jsonb_build_object(
    'item_count',(select count(*)::integer from public.stock_items where tenant_id=_tenant_id),
    'low_stock_count',(select count(*)::integer from public.stock_items where tenant_id=_tenant_id and active is distinct from false and coalesce(min_quantity,0)>0 and coalesce(current_quantity,0)<=min_quantity),
    'recent_movement_count',(select count(*)::integer from public.stock_movements where tenant_id=_tenant_id and moved_at>=now()-interval '30 days')
  );
end;
$function$;

revoke all on function public.stock_items_page_v1(uuid,text,text,text,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.stock_movements_page_v1(uuid,text,text,timestamptz,timestamptz,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.stock_workspace_metrics_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.stock_items_page_v1(uuid,text,text,text,integer,integer) to authenticated;
grant execute on function public.stock_movements_page_v1(uuid,text,text,timestamptz,timestamptz,integer,integer) to authenticated;
grant execute on function public.stock_workspace_metrics_v1(uuid) to authenticated;
