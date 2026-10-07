-- Function from reviewed baseline-review-v2/application-schema.sql captured on 2026-09-28.
-- Source artifact SHA256: bb32cafc7889018bf4bede288bdbe7ca1278ee769d007b567f41ce9a5dc83aea
-- Definition only; no credentials or customer rows.
CREATE FUNCTION "public"."save_route_template_v1"("_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare t uuid:=nullif(_payload->>'tenant_id','')::uuid;r uuid:=nullif(_payload->>'request_id','')::uuid;h text;stored finance_private.atomic_command_results%rowtype;out jsonb;wps jsonb:=coalesce(_payload->'waypoints','[]');
begin
 if auth.uid() is null or t is null or not public.is_tenant_admin(t) then raise exception 'admin_required' using errcode='42501';end if;
 if r is null then raise exception 'request_id_required' using errcode='22023';end if;
 if coalesce(length(btrim(_payload->>'name')),0)=0 then raise exception 'route_name_required' using errcode='22023';end if;
 perform finance_private.assert_tenant_reference('public.geofences',t,nullif(_payload->>'corridor_geofence_id','')::uuid,'corridor_geofence');
 if exists(select 1 from jsonb_to_recordset(wps) x(poi_id uuid) left join public.pois p on p.tenant_id=t and p.id=x.poi_id where x.poi_id is not null and p.id is null) then raise exception 'route_poi_not_found_in_tenant' using errcode='23503';end if;
 if exists(select 1 from jsonb_to_recordset(wps) x(geofence_id uuid) left join public.geofences g on g.tenant_id=t and g.id=x.geofence_id where x.geofence_id is not null and g.id is null) then raise exception 'route_geofence_not_found_in_tenant' using errcode='23503';end if;
 _payload:=jsonb_set(_payload,'{name}',to_jsonb(btrim(_payload->>'name')));
 h:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(t::text||':route:'||r::text,0));
 select * into stored from finance_private.atomic_command_results where tenant_id=t and action='save_route_template' and request_id=r;
 if found then if stored.payload_hash<>h then raise exception 'request_payload_mismatch' using errcode='22023';end if;return stored.result;end if;
 out:=finance_private.save_route_template_unsafe_20260917(_payload);
 insert into finance_private.atomic_command_results values(t,'save_route_template',r,h,out,auth.uid(),now());return out;
end;$$;
