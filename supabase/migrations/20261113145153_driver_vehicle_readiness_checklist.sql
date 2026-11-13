set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function private.driver_pre_checklist_complete_v2(_payload jsonb)
returns boolean language plpgsql immutable set search_path=''
as $helper$
declare value jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or jsonb_typeof(_payload->'checked_items') is distinct from 'array' then return false;end if;
 if _payload ? 'checklist_model' or (_payload ? 'schema_version' and _payload->'schema_version' is distinct from '1'::jsonb) then
  if _payload->'schema_version' is distinct from '2'::jsonb or _payload->>'checklist_model' is distinct from 'vehicle_readiness_v1'
   or _payload->'total_items' is distinct from '6'::jsonb or jsonb_typeof(_payload->'answers') is distinct from 'array' then return false;end if;
  if jsonb_array_length(_payload->'answers')<>6 or jsonb_array_length(_payload->'checked_items')<>6
   or not (_payload->'checked_items' @> '[0,1,2,3,4,5]'::jsonb) then return false;end if;
  for value in select jsonb_array_elements(_payload->'answers') loop
   if jsonb_typeof(value)<>'boolean' then return false;end if;
  end loop;
  return true;
 end if;
 return jsonb_array_length(_payload->'checked_items')=8 and _payload->'checked_items' @> '[0,1,2,3,4,5,6,7]'::jsonb
  and (not (_payload ? 'total_items') or _payload->'total_items'='8'::jsonb);
end;
$helper$;
revoke all on function private.driver_pre_checklist_complete_v2(jsonb) from public,anon,authenticated,service_role;
do $patch$
declare definition text;original_hash text;
begin
 select pg_get_functiondef(oid),md5(prosrc) into definition,original_hash from pg_proc where oid='driver_create_event(uuid,text,jsonb,uuid,text)'::regprocedure;
 if position('private.driver_pre_checklist_complete_v2' in definition)=0 then
  if original_hash<>'754dd9335eb987248a81f0179416417e' then raise exception 'driver_readiness_source_changed';end if;
  definition:=replace(definition,$old$      if coalesce(v_checked_items, 0) <> v_expected_items then$old$,$new$      if _event_type='start_shift' then
        v_checked_items:=case when private.driver_pre_checklist_complete_v2(v_checklist_payload) then v_expected_items else 0 end;
      end if;
      if coalesce(v_checked_items, 0) <> v_expected_items then$new$);
  execute definition;
 end if;
end;
$patch$;
do $patch$
declare definition text;original_hash text;
begin
 select pg_get_functiondef(oid),md5(prosrc) into definition,original_hash from pg_proc where oid='driver_save_checklist(uuid,text,jsonb)'::regprocedure;
 if position('private.driver_pre_checklist_complete_v2' in definition)=0 then
  if original_hash<>'2f8ee205ce2a37008605ce556895a4f8' then raise exception 'driver_readiness_source_changed';end if;
  definition:=replace(definition,$old$  v_total := case _kind when 'pre' then 8 else 5 end;$old$,$new$  v_total := case _kind when 'pre' then 8 else 5 end;
  if _kind='pre' and (_payload ? 'checklist_model' or (_payload ? 'schema_version' and _payload->'schema_version' is distinct from '1'::jsonb)) then
    if not private.driver_pre_checklist_complete_v2(_payload) then raise exception 'invalid_vehicle_readiness' using errcode='22023';end if;
    v_total:=6;
  end if;$new$);
  definition:=replace(definition,$old$_payload || jsonb_build_object('checked_items',v_checked$old$,$new$_payload || case when v_total=6 then jsonb_build_object('has_vehicle_issues',
      exists(select 1 from jsonb_array_elements(_payload->'answers') a where a.value='false'::jsonb)) else '{}'::jsonb end
      || jsonb_build_object('checked_items',v_checked$new$);
  execute definition;
 end if;
end;
$patch$;
do $patch$
declare definition text;original_hash text;
begin
 select pg_get_functiondef(oid),md5(prosrc) into definition,original_hash from pg_proc where oid='private.driver_update_trip_cargo(uuid,uuid,uuid,text,jsonb)'::regprocedure;
 if position('private.driver_pre_checklist_complete_v2' in definition)=0 then
  if original_hash<>'c1680fb132f7940e998c2078eb2defb5' then raise exception 'driver_readiness_source_changed';end if;
  definition:=replace(definition,$old$jsonb_typeof(event.payload->'checked_items')='array' and jsonb_array_length(event.payload->'checked_items')=8$old$,$new$private.driver_pre_checklist_complete_v2(event.payload)$new$);
  execute definition;
 end if;
end;
$patch$;
