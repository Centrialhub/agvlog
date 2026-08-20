
-- Trigger function: update inventory_balances on inventory_movements insert
CREATE OR REPLACE FUNCTION public.update_inventory_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path TO 'public'
AS $$
DECLARE
  _sign integer;
  _now timestamptz := now();
BEGIN
  -- Determine sign based on movement type
  IF NEW.movement_type = 'inbound' THEN
    _sign := 1;
  ELSIF NEW.movement_type = 'outbound' THEN
    _sign := -1;
  ELSIF NEW.movement_type = 'adjustment' THEN
    _sign := 1; -- adjustment quantity can be negative
  ELSIF NEW.movement_type = 'transfer' THEN
    _sign := 0; -- transfers handled separately if needed
  ELSE
    _sign := 0;
  END IF;

  IF _sign = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.inventory_balances (
    tenant_id, location_id, client_id, item_description,
    quantity, pallet_count, weight_kg, volume_m3,
    first_inbound_at, last_movement_at, updated_at
  )
  VALUES (
    NEW.tenant_id,
    NEW.location_id,
    NEW.client_id,
    NEW.item_description,
    COALESCE(NEW.quantity, 0) * _sign,
    COALESCE(NEW.pallet_count, 0) * _sign,
    COALESCE(NEW.weight_kg, 0) * _sign,
    COALESCE(NEW.volume_m3, 0) * _sign,
    CASE WHEN NEW.movement_type = 'inbound' THEN _now ELSE NULL END,
    _now,
    _now
  )
  ON CONFLICT (tenant_id, location_id, client_id, item_description)
  DO UPDATE SET
    quantity = inventory_balances.quantity + COALESCE(NEW.quantity, 0) * _sign,
    pallet_count = inventory_balances.pallet_count + COALESCE(NEW.pallet_count, 0) * _sign,
    weight_kg = COALESCE(inventory_balances.weight_kg, 0) + COALESCE(NEW.weight_kg, 0) * _sign,
    volume_m3 = COALESCE(inventory_balances.volume_m3, 0) + COALESCE(NEW.volume_m3, 0) * _sign,
    first_inbound_at = COALESCE(inventory_balances.first_inbound_at,
      CASE WHEN NEW.movement_type = 'inbound' THEN _now ELSE NULL END),
    last_movement_at = _now,
    updated_at = _now;

  RETURN NEW;
END;
$$;

-- Attach trigger
CREATE TRIGGER trg_inventory_movement_balance
  AFTER INSERT ON public.inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_inventory_balance();
