-- Generated incremental rollback; no historical/data backfill, no ACL/schema changes.
-- Execute only in the reviewed isolated target, in an outer transaction with lock/statement timeouts.
do $cargo_weight$
declare v_oid oid;v_source text;v_definition text;v_new text;v_owner oid;v_acl aclitem[];v_config text[];
begin
  v_oid:=pg_catalog.to_regprocedure('private.driver_update_trip_cargo(uuid,uuid,uuid,text,jsonb)');
  if v_oid is null or not exists(select 1 from pg_catalog.pg_proc p where p.oid=v_oid
    and p.prosecdef and p.proowner='postgres'::regrole
    and p.proconfig in(array['search_path=""']::text[],array['search_path=""','extra_float_digits=3']::text[])
    and p.prorettype='jsonb'::regtype and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql'))
    or pg_catalog.has_function_privilege('anon',v_oid,'execute')
    or pg_catalog.has_function_privilege('authenticated',v_oid,'execute')
    or pg_catalog.has_function_privilege('service_role',v_oid,'execute') then
    raise exception 'trip_cargo_weight_contract_identity_drift';end if;
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(
      'public.driver_update_trip_cargo_v1(uuid,uuid,uuid,text,jsonb)') and md5(p.prosrc)='54f27bd013f36ac7e1558cd783ffa3d1'
      and p.prosecdef and p.proowner='postgres'::regrole and p.proconfig=array['search_path=""']::text[]
      and p.prorettype='jsonb'::regtype and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql'))
    or not pg_catalog.has_function_privilege('authenticated','public.driver_update_trip_cargo_v1(uuid,uuid,uuid,text,jsonb)','execute')
    or pg_catalog.has_function_privilege('anon','public.driver_update_trip_cargo_v1(uuid,uuid,uuid,text,jsonb)','execute')
    or pg_catalog.has_function_privilege('service_role','public.driver_update_trip_cargo_v1(uuid,uuid,uuid,text,jsonb)','execute')
    or not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure(
      'private.require_trip_cargo_actor(uuid,uuid,boolean)') and md5(p.prosrc)='2e5d786ae5ed1c66d0581dbcde858bde') then
    raise exception 'trip_cargo_weight_dependency_drift';end if;
  select p.prosrc,pg_catalog.pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig
    into v_source,v_definition,v_owner,v_acl,v_config from pg_catalog.pg_proc p where p.oid=v_oid;
  if (md5(v_source)='b3d9ae1864f6e7cbf4fae8c4d6df7d80' and v_config is distinct from array['search_path=""']::text[])
    or (md5(v_source)='c1680fb132f7940e998c2078eb2defb5' and v_config is distinct from array['search_path=""','extra_float_digits=3']::text[]) then
    raise exception 'trip_cargo_weight_configuration_drift';end if;
  if md5(v_source)='b3d9ae1864f6e7cbf4fae8c4d6df7d80' then return;end if;
  if md5(v_source)<>'c1680fb132f7940e998c2078eb2defb5' then raise exception 'trip_cargo_weight_predecessor_drift: %',md5(v_source);end if;
  v_new:=v_source;
  v_new:=replace(v_new,$from$perform public._log_entity_audit(_tenant_id,'trip_cargo_control',v_control.id,_action,null,
    case when _action='confirm_cargo' then v_result||jsonb_build_object('weight_precision',
      jsonb_build_object('unit','kg','decimal_places',2,'rounding','decimal_half_up','loads',v_weight_audit))
    else v_result end,'driver_app');$from$,$to$perform public._log_entity_audit(_tenant_id,'trip_cargo_control',v_control.id,_action,null,v_result,'driver_app');$to$);
  v_new:=replace(v_new,$from$if abs(pg_catalog.round(v_expected,2)-v_weight)>1 then$from$,$to$if abs(coalesce(v_load.expected_weight_kg,0)-(v_item->>'weight_kg')::numeric)>1 then$to$);
  v_new:=replace(v_new,$from$confirmed_pallet_count=(v_item->>'pallet_count')::integer,confirmed_weight_kg=pg_catalog.round(v_weight,2),$from$,$to$confirmed_pallet_count=(v_item->>'pallet_count')::integer,confirmed_weight_kg=(v_item->>'weight_kg')::numeric,$to$);
  v_new:=replace(v_new,$from$      -- Manual confirmations have centesimal precision. Preserve the raw source snapshot.
      if jsonb_typeof(v_item->'weight_kg') is distinct from 'number' then
        raise exception 'trip_cargo_weight_invalid' using errcode='22023';end if;
      v_weight:=(v_item->>'weight_kg')::numeric;
      if v_weight<0 or v_weight::text in('NaN','Infinity','-Infinity')
        or v_weight*100>9007199254740991 then
        raise exception 'trip_cargo_weight_invalid' using errcode='22023';end if;
      if v_weight<>pg_catalog.round(v_weight,2) then
        raise exception 'trip_cargo_weight_precision_required' using errcode='22023';end if;
      if v_weight<>v_weight::double precision::text::numeric then
        raise exception 'trip_cargo_weight_invalid' using errcode='22023';end if;
      if coalesce(v_load.expected_weight_kg,0)::text in('NaN','Infinity','-Infinity') then
        raise exception 'trip_cargo_expected_weight_invalid' using errcode='22023';end if;
      -- Match String(Number(source)) before decimal half-up. Float output is scoped to this function.
      begin
        v_expected:=coalesce(v_load.expected_weight_kg,0)::double precision::text::numeric;
      exception when numeric_value_out_of_range then
        if coalesce(v_load.expected_weight_kg,0)>=0 and coalesce(v_load.expected_weight_kg,0)<1e-308 then v_expected:=0;
        else raise exception 'trip_cargo_expected_weight_invalid' using errcode='22023';end if;
      end;
      if v_expected<0 or pg_catalog.round(v_expected,2)*100>9007199254740991 then
        raise exception 'trip_cargo_expected_weight_invalid' using errcode='22023';end if;
      v_weight_audit:=v_weight_audit||jsonb_build_array(jsonb_build_object(
        'load_id',v_load.load_id,'expected_raw_kg',v_load.expected_weight_kg::text,
        'expected_received_decimal_kg',v_expected::text,'expected_rounded_kg',pg_catalog.round(v_expected,2)::text,
        'confirmed_input_kg',v_item->>'weight_kg','confirmed_kg',pg_catalog.round(v_weight,2)::text,
        'expected_rounded',coalesce(v_load.expected_weight_kg,0)<>pg_catalog.round(v_expected,2)));
      update public.trip_cargo_load_checks set confirmed_volume_count=(v_item->>'volume_count')::numeric,$from$,$to$      update public.trip_cargo_load_checks set confirmed_volume_count=(v_item->>'volume_count')::numeric,$to$);
  v_new:=replace(v_new,$from$v_hash text;v_result jsonb;v_item jsonb;v_load public.trip_cargo_load_checks%rowtype;v_kind text;v_description text;
  v_weight numeric;v_expected numeric;v_weight_audit jsonb:='[]'::jsonb;$from$,$to$v_hash text;v_result jsonb;v_item jsonb;v_load public.trip_cargo_load_checks%rowtype;v_kind text;v_description text;$to$);
  if md5(v_new)<>'b3d9ae1864f6e7cbf4fae8c4d6df7d80' then raise exception 'trip_cargo_weight_patch_drift';end if;
  execute replace(v_definition,v_source,v_new);
  alter function private.driver_update_trip_cargo(uuid,uuid,uuid,text,jsonb) reset extra_float_digits;
  if not exists(select 1 from pg_catalog.pg_proc p where p.oid=v_oid and p.proowner=v_owner
    and p.proacl is not distinct from v_acl and p.proconfig is not distinct from array['search_path=""']::text[]
    and md5(p.prosrc)='b3d9ae1864f6e7cbf4fae8c4d6df7d80') then raise exception 'trip_cargo_weight_postcondition_failed';end if;
end;$cargo_weight$;
