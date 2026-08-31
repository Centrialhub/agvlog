-- Local candidate: trip_routes.distance_meters describes the latest navigation
-- route, which may cover only the remaining stops. It is not total trip mileage.
begin;
alter table public.trip_routes add column planned_distance_meters numeric,
 add column planned_duration_seconds numeric,add column full_plan_revision text;

create or replace function control_tower_private.full_plan_revision(_tenant_id uuid,_trip_id uuid)
returns text language sql stable security invoker set search_path=''
as $function$
 select md5(jsonb_build_object('vehicle',t.vehicle_id,'stops',
 (select jsonb_agg(jsonb_build_array(s.id,s.stop_order,s.latitude,s.longitude) order by s.stop_order,s.id)
 from public.dispatch_stops s where s.tenant_id=t.tenant_id and s.dispatch_trip_id=t.id))::text)
 from public.dispatch_trips t where t.tenant_id=_tenant_id and t.id=_trip_id;
$function$;

create or replace function control_tower_private.settlement_route_km(_tenant_id uuid,_trip_id uuid)
returns numeric language sql stable security invoker set search_path=''
as $function$
 select r.planned_distance_meters/1000.0 from public.trip_routes r
 where r.tenant_id=_tenant_id and r.trip_id=_trip_id and r.provider='osrm'
 and r.full_plan_revision=control_tower_private.full_plan_revision(_tenant_id,_trip_id);
$function$;
revoke all on function control_tower_private.full_plan_revision(uuid,uuid),control_tower_private.settlement_route_km(uuid,uuid)
 from public,anon,authenticated,service_role;
-- No backfill: a legacy/live distance cannot establish a full planned estimate.
create or replace function control_tower_private.commit_route(_tenant_id uuid,_trip_id uuid,_request_id uuid,_attempt_id uuid,_route jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare t public.dispatch_trips%rowtype;q control_tower_private.route_calculations%rowtype;
 _now timestamptz;_hash text;g jsonb;c jsonb;w jsonb;_first jsonb;_last jsonb;_distance double precision;_duration double precision;
 _id uuid;_result jsonb;_n integer;_index integer:=0;_len double precision:=0;_previous jsonb;_full_revision text;
begin
 perform control_tower_private.assert_route_actor(_tenant_id);
 select * into t from public.dispatch_trips where tenant_id=_tenant_id and id=_trip_id for update;
 if not found then raise exception 'Trip unavailable' using errcode='42501';end if;
 perform 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() for share nowait;
 perform control_tower_private.assert_route_actor(_tenant_id);
 select * into q from control_tower_private.route_calculations where tenant_id=_tenant_id and trip_id=_trip_id
 and actor_id=auth.uid() and request_id=_request_id;
 if q.request_id is null then raise exception 'Cálculo não preparado.' using errcode='PT409',hint='route_context_changed';end if;
 _hash:=md5(_route::text);
 if q.result is not null then
   if q.payload_hash is distinct from _hash then raise exception 'Request payload changed' using errcode='PT409',hint='route_payload_changed';end if;
   return q.result;
 end if;
 perform 1 from public.dispatch_stops where tenant_id=_tenant_id and dispatch_trip_id=_trip_id order by id for share nowait;
 perform 1 from public.positions_last where tenant_id=_tenant_id and vehicle_id=t.vehicle_id for share nowait;
 perform 1 from public.trip_routes where tenant_id=_tenant_id and trip_id=_trip_id and provider='osrm' for update nowait;
 _now:=clock_timestamp();
 if q.attempt_id is distinct from _attempt_id or q.lease_until<=_now or q.created_at<_now-interval '2 minutes'
   or t.status not in ('planned','loading','dispatched','in_transit','in_progress')
   or q.input_revision is distinct from control_tower_private.context_revision(_tenant_id,_trip_id) then
   raise exception 'O contexto mudou ou o cálculo expirou. Nenhuma rota foi gravada.' using errcode='PT409',hint='route_context_changed';end if;
 if t.status in ('in_transit','in_progress') and not exists(select 1 from public.positions_last where tenant_id=_tenant_id and vehicle_id=t.vehicle_id
   and captured_at>_now-interval '15 minutes' and captured_at<=_now and lat between -90 and 90 and lng between -180 and 180) then
   raise exception 'A posição GPS expirou durante o cálculo.' using errcode='PT409',hint='route_context_changed';end if;
 g:=_route->'geometry';
 if jsonb_typeof(_route->'distance_meters') is distinct from 'number' or jsonb_typeof(_route->'duration_seconds') is distinct from 'number'
   or jsonb_typeof(_route->'waypoints') is distinct from 'array' or g->>'type' is distinct from 'LineString'
   or jsonb_typeof(g->'coordinates') is distinct from 'array' then raise exception 'Invalid routing result' using errcode='22023';end if;
 _distance:=(_route->>'distance_meters')::double precision;_duration:=(_route->>'duration_seconds')::double precision;
 if not(_distance>=0 and _distance<'Infinity'::double precision and _duration>=0 and _duration<'Infinity'::double precision)
   or jsonb_array_length(g->'coordinates') not between 2 and 100000 or octet_length(_route::text)>8000000 then
   raise exception 'Invalid routing metrics or geometry size' using errcode='22023';end if;
 -- Validate each point even for direct RPC calls. An authorized operator submits
 -- route geometry; this is not cryptographic attestation of an OSRM response.
 perform control_tower_private.route_distance_m(0,0,g);
 if exists(select 1 from jsonb_array_elements(g->'coordinates') point where jsonb_array_length(point)<>2) then
   raise exception 'Route requires two-dimensional coordinates' using errcode='22023';end if;
 _n:=jsonb_array_length(q.coordinates);
 if jsonb_array_length(_route->'waypoints')<>_n then raise exception 'Missing routing waypoints' using errcode='22023';end if;
 for c in select value from jsonb_array_elements(q.coordinates) loop
   w:=_route->'waypoints'->_index->'location';
   if jsonb_typeof(w) is distinct from 'array' then raise exception 'Invalid waypoint' using errcode='22023';end if;
   if jsonb_array_length(w)<>2 or jsonb_typeof(w->0)<>'number' or jsonb_typeof(w->1)<>'number' then raise exception 'Invalid waypoint' using errcode='22023';end if;
   if not((w->>1)::double precision between -90 and 90 and (w->>0)::double precision between -180 and 180)
     or control_tower_private.distance_m((c->>'lat')::double precision,(c->>'lng')::double precision,(w->>1)::double precision,(w->>0)::double precision)>200
     or control_tower_private.route_distance_m((w->>1)::double precision,(w->>0)::double precision,g)>200 then
     raise exception 'Route does not include every requested waypoint' using errcode='22023';end if;
   _index:=_index+1;
 end loop;
 _first:=q.coordinates->0;_last:=q.coordinates->(_n-1);
 if control_tower_private.distance_m((_first->>'lat')::double precision,(_first->>'lng')::double precision,(g->'coordinates'->0->>1)::double precision,(g->'coordinates'->0->>0)::double precision)>200
   or control_tower_private.distance_m((_last->>'lat')::double precision,(_last->>'lng')::double precision,(g->'coordinates'->-1->>1)::double precision,(g->'coordinates'->-1->>0)::double precision)>200 then
   raise exception 'Route endpoints do not match request' using errcode='22023';end if;
 for c in select value from jsonb_array_elements(g->'coordinates') loop
   if _previous is not null then _len:=_len+control_tower_private.distance_m((_previous->>1)::double precision,(_previous->>0)::double precision,(c->>1)::double precision,(c->>0)::double precision);end if;
   _previous:=c;
 end loop;
 if _distance+greatest(100,_len*0.05)<_len or (_distance>0 and _duration<=0) then raise exception 'Routing metrics contradict geometry' using errcode='22023';end if;
 -- The real trip_routes trigger marks settlements outdated and logs an event.
 -- Fail fast on a financial writer's lock rather than invert its lock order.
 perform 1 from public.driver_settlements where tenant_id=_tenant_id and dispatch_trip_id=_trip_id order by id for update nowait;
 if t.status in ('planned','loading','dispatched') and t.actual_start_at is null and not exists(select 1 from public.dispatch_stops where tenant_id=_tenant_id and dispatch_trip_id=_trip_id and status=any(public.stop_terminal_statuses())) then _full_revision:=control_tower_private.full_plan_revision(_tenant_id,_trip_id);end if;
 insert into public.trip_routes(tenant_id,trip_id,provider,geometry_geojson,distance_meters,duration_seconds,origin_lat,origin_lng,destination_lat,destination_lng,waypoints,calculated_at,updated_at,plan_revision,planned_distance_meters,planned_duration_seconds,full_plan_revision)
 values(_tenant_id,_trip_id,'osrm',g,_distance,_duration,(_first->>'lat')::double precision,(_first->>'lng')::double precision,
   (_last->>'lat')::double precision,(_last->>'lng')::double precision,_route->'waypoints',_now,_now,q.plan_revision,case when _full_revision is not null then _distance end,case when _full_revision is not null then _duration end,_full_revision)
 on conflict(trip_id,provider) do update set geometry_geojson=excluded.geometry_geojson,distance_meters=excluded.distance_meters,duration_seconds=excluded.duration_seconds,
 origin_lat=excluded.origin_lat,origin_lng=excluded.origin_lng,destination_lat=excluded.destination_lat,destination_lng=excluded.destination_lng,
 waypoints=excluded.waypoints,calculated_at=excluded.calculated_at,updated_at=excluded.updated_at,plan_revision=excluded.plan_revision,
 planned_distance_meters=case when excluded.full_plan_revision is not null then excluded.planned_distance_meters
   when public.trip_routes.full_plan_revision=control_tower_private.full_plan_revision(_tenant_id,_trip_id) then public.trip_routes.planned_distance_meters end,
 planned_duration_seconds=case when excluded.full_plan_revision is not null then excluded.planned_duration_seconds
   when public.trip_routes.full_plan_revision=control_tower_private.full_plan_revision(_tenant_id,_trip_id) then public.trip_routes.planned_duration_seconds end,
 full_plan_revision=case when excluded.full_plan_revision is not null then excluded.full_plan_revision
   when public.trip_routes.full_plan_revision=control_tower_private.full_plan_revision(_tenant_id,_trip_id) then public.trip_routes.full_plan_revision end
 where public.trip_routes.tenant_id=_tenant_id returning id into _id;
 if _id is null then raise exception 'Route tenant mismatch' using errcode='42501';end if;
 _result:=jsonb_build_object('ok',true,'trip_id',_trip_id,'request_id',_request_id,'route_id',_id,'calculated_at',_now,
   'distance_meters',_distance,'duration_seconds',_duration,'waypoint_count',_n);
 update control_tower_private.route_calculations set result=_result,payload_hash=_hash
 where tenant_id=_tenant_id and trip_id=_trip_id and actor_id=auth.uid() and request_id=_request_id;
 return _result;
end;
$function$;
-- FULL FINANCIAL BUILDER: existing role/attempt/payment rules preserved; only estimate source changes.

CREATE OR REPLACE FUNCTION public._build_driver_settlement(_tenant_id uuid, _dispatch_trip_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trip record;
  v_settlement_id uuid;
  v_existing_status text;
  v_was_new boolean := false;
  v_loads_count int := 0;
  v_stops_count int := 0;
  v_documents_count int := 0;
  v_total_goods numeric := 0;
  v_total_freight_rev numeric := 0;
  v_total_weight numeric := 0;
  v_estimated_km numeric;
  v_appr numeric := 0;
  v_pend numeric := 0;
  v_rej numeric := 0;
  v_exp_total numeric := 0;
  v_appr_reimb numeric := 0;
  v_adj_credits numeric := 0;
  v_adj_debits numeric := 0;
  v_route_origin text;
  v_route_destination text;
  v_route_name text;
  v_total_paid numeric := 0;
  v_payable numeric := 0;
  v_route_result numeric := 0;
  v_snapshot jsonb;
  v_documents jsonb;v_has_redelivery boolean;v_requires_redelivery_review boolean;
BEGIN
  SELECT dt.* INTO v_trip
  FROM public.dispatch_trips dt
  WHERE dt.id = _dispatch_trip_id AND dt.tenant_id = _tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'trip_not_found'; END IF;

  SELECT id, status INTO v_settlement_id, v_existing_status
  FROM public.driver_settlements
  WHERE tenant_id = _tenant_id AND dispatch_trip_id = _dispatch_trip_id;

  IF v_settlement_id IS NOT NULL AND v_existing_status NOT IN ('pending_review','in_review','reopened') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;

  -- Materialize the trip-specific snapshot without caller-owned temp objects.
  select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb),coalesce(bool_or(f.current_delivery_attempt_id is not null),false)
   into v_documents,v_has_redelivery from public._delivery_trip_financial_documents(_tenant_id,_dispatch_trip_id) f;
  v_requires_redelivery_review:=v_has_redelivery and (v_settlement_id is null or v_existing_status is distinct from 'in_review');

  SELECT
    (SELECT count(DISTINCT load_id) FROM (
       SELECT v_trip.load_id AS load_id WHERE v_trip.load_id IS NOT NULL
       UNION
       SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
     ) x WHERE load_id IS NOT NULL),
    (SELECT count(*) FROM public.dispatch_stops WHERE dispatch_trip_id = _dispatch_trip_id),
    jsonb_array_length(v_documents),
    COALESCE((SELECT sum(fd.value) FROM jsonb_populate_recordset(null::public.fiscal_documents,v_documents) fd
              WHERE COALESCE(fd.document_type,'nfe') NOT IN ('cte','ct-e','CTe')), 0),
    COALESCE((SELECT sum(COALESCE(NULLIF(fd.freight_value,0),
                          CASE WHEN COALESCE(fd.document_type,'nfe') IN ('cte','ct-e','CTe') THEN fd.value ELSE 0 END))
              FROM jsonb_populate_recordset(null::public.fiscal_documents,v_documents) fd), 0),
    COALESCE(NULLIF((SELECT sum(fd.weight_kg) FROM jsonb_populate_recordset(null::public.fiscal_documents,v_documents) fd),0),
             COALESCE((SELECT sum(l.total_weight_kg) FROM public.loads l WHERE l.id IN (
                SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
                UNION SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
             )),0))
  INTO v_loads_count, v_stops_count, v_documents_count, v_total_goods, v_total_freight_rev, v_total_weight;

  v_estimated_km := control_tower_private.settlement_route_km(_tenant_id,_dispatch_trip_id);

  -- Expenses split: total approved (route cost) vs. approved-AND-reimbursable (driver payable)
  SELECT
    COALESCE(sum(amount) FILTER (WHERE approval_status='approved'),0),
    COALESCE(sum(amount) FILTER (WHERE approval_status='pending'),0),
    COALESCE(sum(amount) FILTER (WHERE approval_status='rejected'),0),
    COALESCE(sum(amount),0),
    COALESCE(sum(amount) FILTER (WHERE approval_status='approved' AND COALESCE(reimbursable,true)=true),0)
  INTO v_appr, v_pend, v_rej, v_exp_total, v_appr_reimb
  FROM public.driver_expenses
  WHERE tenant_id = _tenant_id AND dispatch_trip_id = _dispatch_trip_id;

  -- Origin: prefer first linked load's origin; else null
  SELECT l.origin INTO v_route_origin
  FROM public.loads l
  WHERE l.id IN (
    SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
    UNION SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
  ) AND l.origin IS NOT NULL
  ORDER BY l.created_at ASC NULLS LAST
  LIMIT 1;

  -- If no load origin, use first stop destination as origin proxy
  IF v_route_origin IS NULL THEN
    SELECT ds.destination INTO v_route_origin
    FROM public.dispatch_stops ds
    WHERE ds.dispatch_trip_id = _dispatch_trip_id
    ORDER BY ds.stop_order ASC NULLS LAST, ds.created_at ASC NULLS LAST
    LIMIT 1;
  END IF;

  -- Destination: last stop's destination; fallback to load destination
  SELECT ds.destination INTO v_route_destination
  FROM public.dispatch_stops ds
  WHERE ds.dispatch_trip_id = _dispatch_trip_id
  ORDER BY ds.stop_order DESC NULLS LAST, ds.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_route_destination IS NULL THEN
    SELECT l.destination INTO v_route_destination
    FROM public.loads l
    WHERE l.id IN (
      SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
      UNION SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
    ) AND l.destination IS NOT NULL
    ORDER BY l.created_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  v_route_name := v_trip.notes;
  v_route_result := COALESCE(v_total_freight_rev,0) - COALESCE(v_appr,0);

  IF v_settlement_id IS NULL THEN
    v_was_new := true;
    INSERT INTO public.driver_settlements (
      tenant_id, dispatch_trip_id, driver_id, vehicle_id, status,
      trip_started_at, trip_completed_at, route_name, route_origin, route_destination,
      loads_count, stops_count, documents_count,
      total_invoice_value, total_freight_value, total_weight_kg,
      total_goods_value, total_freight_revenue, route_result,
      estimated_km,
      approved_expenses_total, pending_expenses_total, rejected_expenses_total, expenses_total,
      driver_reimbursement_total,
      invoice_balance, operational_balance,
      last_recalculated_at, needs_recalculation, recalculation_reason
    ) VALUES (
      _tenant_id, _dispatch_trip_id, v_trip.driver_id, v_trip.vehicle_id, 'pending_review',
      v_trip.actual_start_at, v_trip.actual_end_at, v_route_name, v_route_origin, v_route_destination,
      v_loads_count, v_stops_count, v_documents_count,
      v_total_goods, v_total_freight_rev, v_total_weight,
      v_total_goods, v_total_freight_rev, v_route_result,
      v_estimated_km,
      v_appr, v_pend, v_rej, v_exp_total,
      v_appr_reimb,
      v_total_goods - v_appr, v_route_result,
      now(), false, NULL
    ) RETURNING id INTO v_settlement_id;
  END IF;

  SELECT
    COALESCE(sum(amount) FILTER (WHERE nature='credit'),0),
    COALESCE(sum(amount) FILTER (WHERE nature='debit'),0)
  INTO v_adj_credits, v_adj_debits
  FROM public.driver_settlement_items
  WHERE settlement_id = v_settlement_id AND item_type='adjustment';

  SELECT COALESCE(sum(amount),0) INTO v_total_paid
  FROM public.driver_settlement_payments WHERE settlement_id = v_settlement_id;

  v_payable := v_adj_credits + v_appr_reimb - v_adj_debits;

  -- Snapshot (fotografia)
  v_snapshot := jsonb_build_object(
    'calculation_version', 'driver_settlement_v3_attempts',
    'redelivery_review_required',v_requires_redelivery_review,
    'generated_at', now(),
    'trip', jsonb_build_object('id', v_trip.id, 'status', v_trip.status, 'started_at', v_trip.actual_start_at, 'ended_at', v_trip.actual_end_at, 'notes', v_trip.notes),
    'driver_id', v_trip.driver_id, 'vehicle_id', v_trip.vehicle_id,
    'route', jsonb_build_object('origin', v_route_origin, 'destination', v_route_destination, 'estimated_km', v_estimated_km),
    'loads', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM public.loads l WHERE l.id IN (
        SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
        UNION SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
      )), '[]'::jsonb),
    'documents', COALESCE((SELECT jsonb_agg(to_jsonb(fd)) FROM jsonb_populate_recordset(null::public.fiscal_documents,v_documents) fd), '[]'::jsonb),
    'expenses', COALESCE((SELECT jsonb_agg(to_jsonb(de)) FROM public.driver_expenses de WHERE de.tenant_id = _tenant_id AND de.dispatch_trip_id = _dispatch_trip_id), '[]'::jsonb),
    'totals', jsonb_build_object(
      'total_goods_value', v_total_goods,
      'total_freight_revenue', v_total_freight_rev,
      'approved_expenses_total', v_appr,
      'driver_reimbursement_total', v_appr_reimb,
      'route_result', v_route_result,
      'driver_credits_total', v_adj_credits,
      'driver_debits_total', v_adj_debits,
      'driver_payable_amount', v_payable,
      'total_paid_amount', v_total_paid,
      'payment_balance', v_payable - v_total_paid
    )
  );

  UPDATE public.driver_settlements SET
    driver_id = v_trip.driver_id,
    vehicle_id = v_trip.vehicle_id,
    trip_started_at = v_trip.actual_start_at,
    trip_completed_at = v_trip.actual_end_at,
    route_name = v_route_name,
    route_origin = v_route_origin,
    route_destination = v_route_destination,
    loads_count = v_loads_count,
    stops_count = v_stops_count,
    documents_count = v_documents_count,
    total_invoice_value = v_total_goods,
    total_freight_value = v_total_freight_rev,
    total_weight_kg = v_total_weight,
    total_goods_value = v_total_goods,
    total_freight_revenue = v_total_freight_rev,
    route_result = v_route_result,
    estimated_km = v_estimated_km,
    approved_expenses_total = v_appr,
    pending_expenses_total = v_pend,
    rejected_expenses_total = v_rej,
    expenses_total = v_exp_total,
    driver_reimbursement_total = v_appr_reimb,
    driver_credits_total = v_adj_credits,
    driver_debits_total = v_adj_debits,
    driver_payable_amount = v_payable,
    manual_adjustments_total = v_adj_credits - v_adj_debits,
    total_paid_amount = v_total_paid,
    payment_balance = v_payable - v_total_paid,
    invoice_balance = v_total_goods - v_appr,
    operational_balance = v_route_result,
    final_amount = v_payable,
    last_recalculated_at = now(),
    needs_recalculation = v_requires_redelivery_review,
    recalculation_reason = case when v_requires_redelivery_review then 'redelivery_pricing_review' else null end,
    snapshot_json = v_snapshot
  WHERE id = v_settlement_id;

  DELETE FROM public.driver_settlement_items
   WHERE settlement_id = v_settlement_id AND item_type <> 'adjustment';

  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT _tenant_id, v_settlement_id, 'load', 'loads', l.id,
         COALESCE(l.load_number, l.origin || ' → ' || l.destination), 0, l.total_weight_kg,
         jsonb_build_object('origin', l.origin, 'destination', l.destination, 'status', l.status, 'pallets', l.total_pallet_count)
  FROM public.loads l
  WHERE l.id IN (
    SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
    UNION
    SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
  );

  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT _tenant_id, v_settlement_id, 'fiscal_document', 'fiscal_documents', fd.id,
         COALESCE(fd.invoice_number, fd.access_key), fd.value, fd.weight_kg,
         jsonb_build_object('document_type', fd.document_type, 'freight_value', fd.freight_value, 'recipient', fd.recipient, 'recipient_city', fd.recipient_city, 'recipient_state', fd.recipient_state, 'status', fd.status)
  FROM jsonb_populate_recordset(null::public.fiscal_documents,v_documents) fd;

  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT _tenant_id, v_settlement_id, 'expense', 'driver_expenses', de.id,
         de.category, de.amount, NULL,
         jsonb_build_object('approval_status', de.approval_status, 'expense_at', de.expense_at, 'receipt_url', de.receipt_url, 'notes', de.notes,
                            'reimbursable', COALESCE(de.reimbursable, true), 'payment_source', COALESCE(de.payment_source,'driver'))
  FROM public.driver_expenses de
  WHERE de.tenant_id = _tenant_id AND de.dispatch_trip_id = _dispatch_trip_id;

  IF v_estimated_km IS NOT NULL THEN
    INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
    VALUES (_tenant_id, v_settlement_id, 'km', 'trip_routes', NULL, 'KM estimado (mapa)', 0, v_estimated_km, jsonb_build_object('provider','osrm'));
  END IF;

  PERFORM public._log_settlement_event(
    v_settlement_id,
    CASE WHEN v_was_new THEN 'generated' ELSE 'recalculated' END,
    NULL, NULL, NULL,
    jsonb_build_object('loads', v_loads_count, 'documents', v_documents_count, 'freight', v_total_freight_rev, 'goods', v_total_goods, 'expenses_approved', v_appr, 'driver_reimbursement', v_appr_reimb)
  );

  RETURN v_settlement_id;
END;
$function$
;
commit;
