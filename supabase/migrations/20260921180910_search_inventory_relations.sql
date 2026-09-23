create or replace function public.list_inventory_balances_page_v1(
  _tenant_id uuid, _search text default null, _client_id uuid default null,
  _location_id uuid default null, _aging boolean default false,
  _page integer default 1, _page_limit integer default 50
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_pattern text; v_total bigint; v_rows jsonb; v_offset integer;
begin
 if _page<1 or _page_limit<1 or _page_limit>100 then raise exception 'inventory_list_invalid_page'; end if;
 v_pattern:=case when nullif(btrim(_search),'') is null then null else '%'||replace(replace(replace(btrim(_search),'\','\\'),'%','\%'),'_','\_')||'%' end;
 v_offset:=(_page-1)*_page_limit;
 select count(*) into v_total from public.inventory_balances b
 left join public.clients c on c.id=b.client_id and c.tenant_id=_tenant_id
 left join public.inventory_locations l on l.id=b.location_id and l.tenant_id=_tenant_id
 where b.tenant_id=_tenant_id and (_client_id is null or b.client_id=_client_id) and (_location_id is null or b.location_id=_location_id)
 and (not _aging or (b.quantity>0 and b.first_inbound_at<statement_timestamp()-interval '30 days'))
 and (v_pattern is null or b.item_description ilike v_pattern escape '\' or c.company_name ilike v_pattern escape '\' or l.name ilike v_pattern escape '\');
 select coalesce(jsonb_agg(row_value order by sort_time nulls last, sort_name, sort_id),'[]'::jsonb) into v_rows from (
  select to_jsonb(b)||jsonb_build_object('clients',case when c.id is null then null else jsonb_build_object('company_name',c.company_name) end,
   'inventory_locations',case when l.id is null then null else jsonb_build_object('name',l.name) end) row_value,
   case when _aging then b.first_inbound_at else null end sort_time,case when _aging then '' else b.item_description end sort_name,b.id sort_id
  from public.inventory_balances b left join public.clients c on c.id=b.client_id and c.tenant_id=_tenant_id
  left join public.inventory_locations l on l.id=b.location_id and l.tenant_id=_tenant_id
  where b.tenant_id=_tenant_id and (_client_id is null or b.client_id=_client_id) and (_location_id is null or b.location_id=_location_id)
  and (not _aging or (b.quantity>0 and b.first_inbound_at<statement_timestamp()-interval '30 days'))
  and (v_pattern is null or b.item_description ilike v_pattern escape '\' or c.company_name ilike v_pattern escape '\' or l.name ilike v_pattern escape '\')
  order by case when _aging then b.first_inbound_at end asc nulls last,case when not _aging then b.item_description end asc,b.id limit _page_limit offset v_offset
 ) page_rows;
 return jsonb_build_object('rows',v_rows,'total',v_total);
end$$;

create or replace function public.list_inventory_movements_page_v1(
 _tenant_id uuid,_search text default null,_client_id uuid default null,_location_id uuid default null,
 _movement_type text default null,_from date default null,_to date default null,_timezone text default 'America/Sao_Paulo',_page integer default 1,_page_limit integer default 50
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_pattern text;v_total bigint;v_rows jsonb;v_offset integer;
begin
 if _page<1 or _page_limit<1 or _page_limit>100 or (_from is not null and _to is not null and _from>_to) then raise exception 'inventory_list_invalid_filters';end if;
 v_pattern:=case when nullif(btrim(_search),'') is null then null else '%'||replace(replace(replace(btrim(_search),'\','\\'),'%','\%'),'_','\_')||'%' end;v_offset:=(_page-1)*_page_limit;
 select count(*) into v_total from public.inventory_movements m left join public.clients c on c.id=m.client_id and c.tenant_id=_tenant_id
 left join public.inventory_locations l on l.id=m.location_id and l.tenant_id=_tenant_id where m.tenant_id=_tenant_id
 and (_client_id is null or m.client_id=_client_id) and (_location_id is null or m.location_id=_location_id) and (_movement_type is null or m.movement_type=_movement_type)
 and (_from is null or m.moved_at>=(_from::timestamp at time zone _timezone)) and (_to is null or m.moved_at<((_to+1)::timestamp at time zone _timezone))
 and (v_pattern is null or m.item_description ilike v_pattern escape '\' or c.company_name ilike v_pattern escape '\' or l.name ilike v_pattern escape '\');
 select coalesce(jsonb_agg(row_value order by moved_at desc,id desc),'[]'::jsonb) into v_rows from (
  select to_jsonb(m)||jsonb_build_object('clients',case when c.id is null then null else jsonb_build_object('company_name',c.company_name) end,
   'inventory_locations',case when l.id is null then null else jsonb_build_object('name',l.name) end) row_value,m.moved_at,m.id
  from public.inventory_movements m left join public.clients c on c.id=m.client_id and c.tenant_id=_tenant_id left join public.inventory_locations l on l.id=m.location_id and l.tenant_id=_tenant_id
  where m.tenant_id=_tenant_id and (_client_id is null or m.client_id=_client_id) and (_location_id is null or m.location_id=_location_id) and (_movement_type is null or m.movement_type=_movement_type)
  and (_from is null or m.moved_at>=(_from::timestamp at time zone _timezone)) and (_to is null or m.moved_at<((_to+1)::timestamp at time zone _timezone))
  and (v_pattern is null or m.item_description ilike v_pattern escape '\' or c.company_name ilike v_pattern escape '\' or l.name ilike v_pattern escape '\')
  order by m.moved_at desc,m.id desc limit _page_limit offset v_offset
 ) page_rows;
 return jsonb_build_object('rows',v_rows,'total',v_total);
end$$;

revoke all on function public.list_inventory_balances_page_v1(uuid,text,uuid,uuid,boolean,integer,integer) from public,anon;
grant execute on function public.list_inventory_balances_page_v1(uuid,text,uuid,uuid,boolean,integer,integer) to authenticated,service_role;
revoke all on function public.list_inventory_movements_page_v1(uuid,text,uuid,uuid,text,date,date,text,integer,integer) from public,anon;
grant execute on function public.list_inventory_movements_page_v1(uuid,text,uuid,uuid,text,date,date,text,integer,integer) to authenticated,service_role;
