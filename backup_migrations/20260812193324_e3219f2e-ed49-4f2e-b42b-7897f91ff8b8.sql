
-- Create the function to add manual driver expenses to a settlement
CREATE OR REPLACE FUNCTION public.add_driver_settlement_manual_expense(
  _settlement_id uuid,
  _category text,
  _amount numeric,
  _expense_at timestamptz,
  _cost_center text,
  _payment_source text DEFAULT 'driver',
  _reimbursable boolean DEFAULT true,
  _receipt_url text DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_driver_id uuid;
  v_vehicle_id uuid;
  v_expense_id uuid;
  v_settlement_status text;
BEGIN
  -- 1. Check if settlement exists and is not locked
  SELECT tenant_id, driver_id, vehicle_id, status 
    INTO v_tenant_id, v_driver_id, v_vehicle_id, v_settlement_status
  FROM public.driver_settlements 
  WHERE id = _settlement_id;
  
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  
  -- We allow adding expenses even in review mode, but not approved/paid/closed
  IF v_settlement_status NOT IN ('pending_review', 'in_review', 'reopened') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;

  -- 2. Create the driver_expense record
  -- We set approval_status to 'approved' since this is a manual back-office entry
  INSERT INTO public.driver_expenses (
    tenant_id,
    driver_id,
    vehicle_id,
    category,
    amount,
    expense_at,
    payment_source,
    reimbursable,
    receipt_url,
    notes,
    cost_center,
    approval_status,
    approved_at,
    approved_by
  ) VALUES (
    v_tenant_id,
    v_driver_id,
    v_vehicle_id,
    _category,
    _amount,
    _expense_at,
    _payment_source,
    _reimbursable,
    _receipt_url,
    _notes,
    _cost_center,
    'approved',
    now(),
    auth.uid()
  ) RETURNING id INTO v_expense_id;

  -- 3. Create the driver_settlement_item
  INSERT INTO public.driver_settlement_items (
    tenant_id,
    settlement_id,
    item_type,
    source_table,
    source_id,
    description,
    amount,
    quantity,
    metadata
  ) VALUES (
    v_tenant_id,
    _settlement_id,
    'expense',
    'driver_expenses',
    v_expense_id,
    _category,
    _amount,
    1,
    jsonb_build_object(
      'expense_at', _expense_at,
      'approval_status', 'approved',
      'payment_source', _payment_source,
      'reimbursable', _reimbursable,
      'receipt_url', _receipt_url,
      'cost_center', _cost_center,
      'notes', _notes
    )
  );

  -- 4. Mark settlement for recalculation
  UPDATE public.driver_settlements 
  SET needs_recalculation = true,
      recalculation_reason = 'Manual expense added'
  WHERE id = _settlement_id;

  -- 5. Audit Log
  PERFORM public._log_settlement_event(
    _settlement_id, 
    'manual_expense_added', 
    NULL, 
    NULL, 
    _notes,
    jsonb_build_object(
      'expense_id', v_expense_id,
      'amount', _amount,
      'category', _category
    )
  );

  RETURN v_expense_id;
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.add_driver_settlement_manual_expense(uuid, text, numeric, timestamptz, text, text, boolean, text, text) TO authenticated;
