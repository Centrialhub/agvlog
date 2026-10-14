-- Operational revocation prerequisites only. No membership/data/Auth mutation.
-- Preserve driver.active, roles, RLS, existing ACLs and other-operation memberships.
-- Pin each actual predecessor. This does not authorize publication or migration execution.
do $patch$
declare
  item jsonb; replacement jsonb; target oid; original text; revised text;
  definition text; metadata jsonb;
  patches jsonb := $manifest$[
  {
    "signature": "public._assert_driver_owns_trip(uuid)",
    "before": "8a6844c0da1a9c821777a98a28bc6c33",
    "after": "231524ec634cf3b15583976de958cdac",
    "replacements": [
      [
        "      and driver.active",
        "      and driver.active\n      and public.is_tenant_member(v_trip.tenant_id)"
      ]
    ],
    "definer": true
  },
  {
    "signature": "public._lock_driver_journey_trip(uuid)",
    "before": "57fee2509b312474cabdf515f31d959c",
    "after": "a4fcca8c7b8d3f8a1aa92036e424dff4",
    "replacements": [
      [
        "  perform pg_catalog.pg_advisory_xact_lock(",
        "  perform private.require_driver_operation_membership_v1(v_trip.tenant_id);\n  perform pg_catalog.pg_advisory_xact_lock("
      ]
    ],
    "definer": true
  },
  {
    "signature": "public.driver_get_journey_context(uuid)",
    "before": "3464f6d8ded126e91a088530c04fd51b",
    "after": "8dfa530fabc3bd1d90259e4c7eb57115",
    "replacements": [
      [
        "and d.user_id = auth.uid() and d.active)",
        "and d.user_id = auth.uid() and d.active and public.is_tenant_member(_tenant_id))"
      ]
    ],
    "definer": true
  },
  {
    "signature": "public._lock_driver_delivery_stop(uuid)",
    "before": "d7a5b4ef7915e70b2a83f0e20e8c6b6d",
    "after": "045595359a52083accc52c05d531a88a",
    "replacements": [
      [
        "  perform public._assert_driver_owns_trip(v_stop.dispatch_trip_id);",
        "  perform private.require_driver_operation_membership_v1(v_stop.tenant_id);\n  perform public._assert_driver_owns_trip(v_stop.dispatch_trip_id);"
      ]
    ],
    "definer": false
  },
  {
    "signature": "public.driver_register_departure(uuid,text)",
    "before": "8df48f28ceb5ce9585afa6a1b69f9cdb",
    "after": "66f175011f022bfc038d8a40d637dd74",
    "replacements": [
      [
        "  perform public._assert_driver_owns_trip(v_stop.dispatch_trip_id);",
        "  perform private.require_driver_operation_membership_v1(v_stop.tenant_id);\n  perform public._assert_driver_owns_trip(v_stop.dispatch_trip_id);"
      ]
    ],
    "definer": true
  },
  {
    "signature": "public.driver_mark_arrival(uuid,double precision,double precision,double precision)",
    "before": "50a90054d9a97982bc2ff0b09b6fc60e",
    "after": "0f9351ee6444051d6c88ee1b6dbd55d0",
    "replacements": [
      [
        "  perform public._assert_driver_owns_trip(v_stop.dispatch_trip_id);",
        "  perform private.require_driver_operation_membership_v1(v_stop.tenant_id);\n  perform public._assert_driver_owns_trip(v_stop.dispatch_trip_id);"
      ]
    ],
    "definer": true
  },
  {
    "signature": "public.driver_start_trip(uuid)",
    "before": "f1dcc171b5d709ebddc848df5e2c02d7",
    "before_crlf": "b811d2ee48a98b44de55f86f94f77998",
    "after": "3d16e057a332158783f6c706d4129342",
    "replacements": [
      [
        "  v_driver_id := public.current_driver_id(v_trip.tenant_id);",
        "  perform private.require_driver_operation_membership_v1(v_trip.tenant_id);\n  v_driver_id := public.current_driver_id(v_trip.tenant_id);"
      ]
    ],
    "definer": true
  },
  {
    "signature": "public.driver_create_operational_occurrence(uuid,text,text,text,uuid,uuid)",
    "before": "8f4e2d92b0aedb84e4848289aab596de",
    "after": "19abede13bd69e6621552738d7c3167b",
    "replacements": [
      [
        "  if _stop_id is null then",
        "  perform private.require_driver_operation_membership_v1(v_tenant);\n  if _stop_id is null then"
      ]
    ],
    "definer": true
  },
  {
    "signature": "public.driver_apply_offline_command_v1(uuid,uuid,text,jsonb)",
    "before": "0a6ff417857a6a220b42d172a8d70db1",
    "after": "d397e44409e30889da6fe3b441fddf2a",
    "replacements": [
      [
        "  if _request_id is null then",
        "  perform private.require_driver_operation_membership_v1(_tenant_id);\n  if _request_id is null then"
      ]
    ],
    "definer": true
  },
  {
    "signature": "private.require_trip_cargo_actor(uuid,uuid,boolean)",
    "before": "2e5d786ae5ed1c66d0581dbcde858bde",
    "after": "cf597ae1d37ad09182e8b0bfb572591d",
    "replacements": [
      [
        "if auth.uid() is null then",
        "if auth.uid() is null or not public.is_tenant_member(_tenant_id) then"
      ]
    ],
    "definer": true
  },
  {
    "signature": "public.driver_update_trip_cargo_v1(uuid,uuid,uuid,text,jsonb)",
    "before": "54f27bd013f36ac7e1558cd783ffa3d1",
    "after": "8b299faeb50682dfa4a852ab1ab8ba04",
    "replacements": [
      [
        "  perform private.require_trip_cargo_actor(_tenant_id,_trip_id,false);",
        "  perform private.require_driver_operation_membership_v1(_tenant_id);\n  perform private.require_trip_cargo_actor(_tenant_id,_trip_id,false);"
      ]
    ],
    "definer": true
  },
  {
    "signature": "public.current_driver_id(uuid)",
    "before": "17f851e6e25c305debbadc890a3b805a",
    "after": "256237f26eda38c786d226339c3b0977",
    "replacements": [
      [
        "AND active = true",
        "AND active = true AND public.is_tenant_member(_tenant_id)"
      ]
    ],
    "definer": true
  },
  {
    "signature": "public.driver_owns_trip(uuid)",
    "before": "7aabb66a69abc3c2ffd256498c654b72",
    "after": "12412e9d86e1e1d20ce9a5e647ad2113",
    "replacements": [
      [
        "AND d.active = true",
        "AND d.active = true AND public.is_tenant_member(dt.tenant_id)"
      ]
    ],
    "definer": true
  },
  {
    "signature": "private.driver_can_access_vehicle(uuid)",
    "before": "0c5c3e807045dc5459aef53763d1a5b8",
    "after": "4f1b08869e66522fca16485308b502dd",
    "replacements": [
      [
        "      and d.active = true",
        "      and d.active = true\n      and public.is_tenant_member(dt.tenant_id)"
      ]
    ],
    "definer": true
  },
  {
    "signature": "private.driver_owns_stop(uuid)",
    "before": "eb55bfb45035168764fef91fd1901879",
    "after": "2522e7f3232f987daf7526d5823b4ef5",
    "replacements": [
      [
        "      and d.active = true",
        "      and d.active = true\n      and public.is_tenant_member(dt.tenant_id)"
      ]
    ],
    "definer": true
  },
  {
    "signature": "private._driver_trip_ids()",
    "before": "acd6b03973b5d995eb5a2c56007a3a64",
    "after": "383f956020095bd6d54c2ec33095b310",
    "replacements": [
      [
        "and d.active = true;",
        "and d.active = true and public.is_tenant_member(t.tenant_id);"
      ]
    ],
    "definer": true
  },
  {
    "signature": "private._driver_load_ids()",
    "before": "d0a4663acd96c31551e1e83a38853589",
    "after": "f01bd009592b5ee321f1912aa082e679",
    "replacements": [
      [
        "and l.on_hold = false",
        "and l.on_hold = false and public.is_tenant_member(l.tenant_id)",
        3
      ]
    ],
    "definer": true
  },
  {
    "signature": "private.driver_can_read_vehicle_position(uuid,uuid)",
    "before": "80ac1ff8a3993ff690a5403465bebae2",
    "before_crlf": "943a0e187a4d30cd6ea570731c1c797d",
    "after": "9ff3012b5ea6d86390c221a5335fc739",
    "replacements": [
      [
        "        and d.active = true",
        "        and d.active = true\n        and public.is_tenant_member(_tenant_id)"
      ]
    ],
    "definer": true
  },
  {
    "signature": "private.can_access_physical_journey(uuid)",
    "before": "2953fe42a1e78488505aec90676f7549",
    "after": "68cab2d3fa255feb73b39c8dee61f83c",
    "replacements": [
      [
        "and driver.user_id=auth.uid() and driver.active)",
        "and driver.user_id=auth.uid() and driver.active\n          and public.is_tenant_member(driver.tenant_id)\n          and exists(select 1 from public.tenants t where t.id=driver.tenant_id and t.workspace_id=journey.workspace_id))"
      ]
    ],
    "definer": true
  },
  {
    "signature": "public.get_current_driver_journey_v1()",
    "before": "9e520b383a7d76eedabf8e327a7a4b5f",
    "after": "eff759294a519f0722b59dcc5b7fb6d1",
    "replacements": [
      [
        "      and driver.user_id=v_actor and driver.active",
        "      and driver.user_id=v_actor and driver.active\n      and public.is_tenant_member(driver.tenant_id)\n      and exists(select 1 from public.tenants t where t.id=driver.tenant_id and t.workspace_id=journey.workspace_id)"
      ],
      [
        "where link.workspace_person_id=v_journey.workspace_person_id and driver.user_id=v_actor and driver.active",
        "where link.workspace_person_id=v_journey.workspace_person_id and driver.user_id=v_actor and driver.active\n        and public.is_tenant_member(driver.tenant_id)\n        and exists(select 1 from public.tenants t where t.id=driver.tenant_id and t.workspace_id=v_journey.workspace_id)"
      ]
    ],
    "definer": true
  },
  {
    "signature": "public.resolve_delivery_receipt_quality_policy_v1(uuid)",
    "before": "b4841e4097bca9cdebe8200469f89ed0",
    "after": "eaef517f15b6d62d19625c66e803c5d4",
    "replacements": [
      [
        "        and driver.active",
        "        and driver.active\n        and public.is_tenant_member(v_stop.tenant_id)"
      ]
    ],
    "definer": true
  },
  {
    "signature": "public.publish_driver_app_observability_v1(jsonb)",
    "before": "fdef126c817c010e1e4dbaa6ccfa3352",
    "after": "d6beae490337e1813e4395472124e9f6",
    "replacements": [
      [
        "  if not private.is_request_tenant_member(v_tenant)",
        "  perform private.require_driver_operation_membership_v1(v_tenant);\n  if not private.is_request_tenant_member(v_tenant)"
      ]
    ],
    "definer": true
  },
  {
    "signature": "public.disable_driver_app_observability_v1(uuid,uuid)",
    "before": "133f5d5fe89e6df676c18fa51a53d82a",
    "after": "df7ff4e5f8d83d09f40ee0426acfd987",
    "replacements": [
      [
        "  if auth.uid() is null",
        "  perform private.require_driver_operation_membership_v1(_tenant_id);\n  if auth.uid() is null"
      ]
    ],
    "definer": true
  }
]$manifest$::jsonb;
begin
  if not exists(select 1 from pg_proc where oid=to_regprocedure('public.is_tenant_member(uuid)')
      and md5(prosrc)='9dc8218defa0226b77bcb3d8b6718fcb' and prosecdef and proowner='postgres'::regrole) then
    raise exception 'driver_operation_membership_dependency_changed';
  end if;
  -- Verify every dependency before creating a helper or replacing a body.
  for item in select value from jsonb_array_elements(patches) loop
    target:=to_regprocedure(item->>'signature');
    if target is null or not exists(select 1 from pg_proc p where p.oid=target
       and p.proowner='postgres'::regrole and p.prosecdef=(item->>'definer')::boolean
       and md5(p.prosrc) in(item->>'before',item->>'after',item->>'before_crlf')) then
      raise exception 'driver_operation_predecessor_changed: %',item->>'signature';
    end if;
  end loop;
  target:=to_regprocedure('private.require_driver_operation_membership_v1(uuid)');
  if target is null then
    execute $helper$create function private.require_driver_operation_membership_v1(_tenant_id uuid)
returns void language plpgsql volatile security definer set search_path='' as $guard$
begin
  if auth.uid() is null or _tenant_id is null then
    raise exception 'driver_operation_not_authorized' using errcode='42501';
  end if;
  -- Keep the existing membership and its canonical operation stable until commit.
  -- NOWAIT fails closed during deactivation/role changes instead of lock inversion.
  -- Existing role/assignment predicates remain in each caller; no new role is granted.
  perform m.id from public.tenant_memberships m
  join public.tenants t on t.id=m.tenant_id
  where m.tenant_id=_tenant_id and m.user_id=auth.uid() and m.active
    and t.workspace_id is not null
  for share of m,t nowait;
  if not found then
    raise exception 'driver_operation_not_authorized' using errcode='42501';
  end if;
end;
$guard$;$helper$;
    revoke all on function private.require_driver_operation_membership_v1(uuid) from public,anon,authenticated,service_role;
  end if;
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('private.require_driver_operation_membership_v1(uuid)')
      and p.proowner='postgres'::regrole and p.prosecdef and p.provolatile='v'
      and p.proconfig=array['search_path=""']::text[] and md5(p.prosrc)='094c0e69e6b4c861e2d4b607a427bb23')
    or has_function_privilege('anon','private.require_driver_operation_membership_v1(uuid)','execute')
    or has_function_privilege('authenticated','private.require_driver_operation_membership_v1(uuid)','execute')
    or has_function_privilege('service_role','private.require_driver_operation_membership_v1(uuid)','execute') then
    raise exception 'driver_operation_helper_changed';
  end if;
  for item in select value from jsonb_array_elements(patches) loop
    target:=to_regprocedure(item->>'signature');
    select prosrc,pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into original,definition,metadata
      from pg_proc p where p.oid=target;
    if md5(original)=item->>'after' then continue; end if;
    -- Only the two exact CRLF bodies observed in the approved baseline are admitted.
    -- Keep raw original for definition replacement and preserve every metadata check.
    revised:=case when md5(original)=item->>'before_crlf'
      then replace(original,E'\r\n',E'\n') else original end;
    for replacement in select value from jsonb_array_elements(item->'replacements') loop
      if (length(revised)-length(replace(revised,replacement->>0,'')))/length(replacement->>0)
          <>coalesce((replacement->>2)::integer,1) then
        raise exception 'driver_operation_patch_anchor_changed: %',item->>'signature';
      end if;
      revised:=replace(revised,replacement->>0,replacement->>1);
    end loop;
    if md5(revised)<>item->>'after' then raise exception 'driver_operation_patch_changed';end if;
    execute replace(definition,original,revised);
    if (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=target) is distinct from metadata
      or (select md5(prosrc) from pg_proc where oid=target)<>item->>'after' then
      raise exception 'driver_operation_metadata_changed: %',item->>'signature';
    end if;
  end loop;
end;
$patch$;
