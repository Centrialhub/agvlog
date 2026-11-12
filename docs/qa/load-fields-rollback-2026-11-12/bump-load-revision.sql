CREATE OR REPLACE FUNCTION private.bump_load_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if row(
    new.load_number,new.vehicle_id,new.driver_id,new.origin,new.destination,
    new.total_pallet_count,new.total_weight_kg,new.total_volume_m3,new.status,new.trip_id,
    new.notes,new.operation_type,new.distribution_manifest,new.shipment_manifest,
    new.scheduled_load_at,new.actual_load_at,new.trailer_plate,new.merchandise_value,new.ciot,
    new.gate_departure_at,new.arrival_at,new.estimated_arrival_at,new.payment_method,
    new.on_hold,new.hold_reason,new.held_at,new.held_by
  ) is distinct from row(
    old.load_number,old.vehicle_id,old.driver_id,old.origin,old.destination,
    old.total_pallet_count,old.total_weight_kg,old.total_volume_m3,old.status,old.trip_id,
    old.notes,old.operation_type,old.distribution_manifest,old.shipment_manifest,
    old.scheduled_load_at,old.actual_load_at,old.trailer_plate,old.merchandise_value,old.ciot,
    old.gate_departure_at,old.arrival_at,old.estimated_arrival_at,old.payment_method,
    old.on_hold,old.hold_reason,old.held_at,old.held_by
  ) then
    new.version := greatest(coalesce(new.version, old.version), old.version + 1);
  elsif new.version < old.version then
    raise exception 'load_revision_cannot_decrease' using errcode = '23514';
  end if;
  return new;
end;
$function$
