-- Preserve the reason and complete financial context before a settlement is physically deleted.
do $patch$
declare
  body text;
  needle text;
begin
  body := pg_get_functiondef('public.delete_driver_settlement(uuid,text)'::regprocedure);
  if position('driver_settlement_delete' in body) > 0 then return; end if;

  needle := $old$  v_s public.driver_settlements;
begin$old$;
  if position(needle in body) = 0 then raise exception 'driver_settlement_delete_variables_changed'; end if;
  body := replace(body, needle, $new$  v_s public.driver_settlements;
  v_reason text := nullif(btrim(coalesce(_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'deletion_reason_required' using errcode = '22023';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'deletion_reason_too_long' using errcode = '22023';
  end if;$new$);

  needle := $old$  -- Loads are linked canonically through driver_settlement_loads and through
  -- the settlement's dispatch_trip_id. The loads relation has no
  -- driver_settlement_id column and must not be mutated here.$old$;
  if position(needle in body) = 0 then raise exception 'driver_settlement_delete_boundary_changed'; end if;
  body := replace(body, needle, $new$  perform public._log_entity_audit(
    v_s.tenant_id,
    'driver_settlement',
    v_s.id,
    'delete',
    jsonb_build_object(
      'settlement', to_jsonb(v_s),
      'loads', (select coalesce(jsonb_agg(to_jsonb(link)), '[]'::jsonb) from public.driver_settlement_loads link where link.settlement_id = v_s.id),
      'items', (select coalesce(jsonb_agg(to_jsonb(item)), '[]'::jsonb) from public.driver_settlement_items item where item.settlement_id = v_s.id),
      'events', (select coalesce(jsonb_agg(to_jsonb(event)), '[]'::jsonb) from public.driver_settlement_events event where event.settlement_id = v_s.id),
      'payments', (select coalesce(jsonb_agg(to_jsonb(payment)), '[]'::jsonb) from public.driver_settlement_payments payment where payment.settlement_id = v_s.id)
    ),
    jsonb_build_object('reason', v_reason),
    'driver_settlement_delete'
  );

  -- Loads are linked canonically through driver_settlement_loads and through
  -- the settlement's dispatch_trip_id. The loads relation has no
  -- driver_settlement_id column and must not be mutated here.$new$);

  execute body;
end
$patch$;
