
DROP FUNCTION IF EXISTS public.add_driver_settlement_manual_expense(uuid, text, numeric, timestamptz, text, text, boolean, text, text);

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
  v_s public.driver_settlements;
  v_expense_id uuid;
  v_item_id uuid;
  v_tenant_id uuid;
BEGIN
  -- 1. Validate settlement
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement not found';
  END IF;

  -- Apenas 'closed' trava totalmente.
  IF v_s.status = 'closed' THEN
    RAISE EXCEPTION 'Cannot add expenses to a closed settlement';
  END IF;

  v_tenant_id := v_s.tenant_id;

  -- 2. Create the expense record
  INSERT INTO public.driver_expenses (
    tenant_id,
    driver_id,
    vehicle_id,
    category,
    amount,
    expense_date,
    status,
    payment_source,
    reimbursable,
    receipt_url,
    notes,
    cost_center,
    source_table,
    source_id
  ) VALUES (
    v_tenant_id,
    v_s.driver_id,
    v_s.vehicle_id,
    _category,
    _amount,
    _expense_at,
    'completed',
    _payment_source,
    _reimbursable,
    _receipt_url,
    _notes,
    _cost_center,
    'driver_settlements',
    _settlement_id
  ) RETURNING id INTO v_expense_id;

  -- 3. Create the driver_settlement_item to link it
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
    CASE WHEN _payment_source = 'driver' AND _reimbursable THEN _amount ELSE 0 END,
    1,
    jsonb_build_object(
      'category', _category,
      'expense_at', _expense_at,
      'payment_source', _payment_source,
      'reimbursable', _reimbursable,
      'cost_center', _cost_center,
      'total_amount', _amount
    )
  ) RETURNING id INTO v_item_id;

  -- 4. Mark settlement as needing recalculation
  UPDATE public.driver_settlements 
  SET needs_recalculation = true,
      recalculation_reason = 'Nova despesa manual adicionada'
  WHERE id = _settlement_id;

  -- 5. Audit log
  INSERT INTO public.driver_settlement_events (settlement_id, event_type, description, metadata)
  VALUES (_settlement_id, 'expense_added', 'Despesa manual adicionada: ' || _category || ' - ' || _amount, jsonb_build_object('expense_id', v_expense_id));

  RETURN v_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_driver_settlement_manual_expense(uuid, text, numeric, timestamptz, text, text, boolean, text, text) TO authenticated;
