CREATE OR REPLACE FUNCTION public.add_employee_incident_action(
  _incident_id uuid,
  _employee_id uuid,
  _action_type text,
  _description text DEFAULT NULL,
  _amount numeric DEFAULT 0,
  _effective_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_category text;
  v_incident_employee uuid;
  v_emp_tenant uuid;
  v_new_id uuid;
  v_status text;
  v_completed_by uuid;
  v_completed_at timestamptz;
  v_allowed text[] := ARRAY['note','verbal_warning','written_warning','suspension',
                            'training_required','payroll_discount','document_request',
                            'termination_recommendation','other'];
BEGIN
  IF _action_type IS NULL OR NOT (_action_type = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'invalid_action_type';
  END IF;

  SELECT tenant_id, category, employee_id
    INTO v_tenant, v_category, v_incident_employee
  FROM public.incidents WHERE id = _incident_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'incident_not_found'; END IF;

  IF NOT public.is_tenant_operator_or_admin(v_tenant) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF COALESCE(v_category,'') NOT IN ('hr','rh') THEN
    RAISE EXCEPTION 'incident_not_hr';
  END IF;

  IF v_incident_employee IS NULL THEN
    RAISE EXCEPTION 'incident_employee_required';
  END IF;

  IF v_incident_employee <> _employee_id THEN
    RAISE EXCEPTION 'employee_mismatch';
  END IF;

  SELECT tenant_id INTO v_emp_tenant FROM public.employees WHERE id=_employee_id;
  IF v_emp_tenant IS NULL OR v_emp_tenant <> v_tenant THEN
    RAISE EXCEPTION 'employee_tenant_mismatch';
  END IF;

  IF _action_type = 'payroll_discount' AND COALESCE(_amount,0) <= 0 THEN
    RAISE EXCEPTION 'amount_required_for_discount';
  END IF;

  IF _action_type = 'payroll_discount' THEN
    v_status := 'completed';
    v_completed_by := auth.uid();
    v_completed_at := now();
  ELSE
    v_status := 'open';
    v_completed_by := NULL;
    v_completed_at := NULL;
  END IF;

  INSERT INTO public.employee_incident_actions(
    tenant_id, incident_id, employee_id, action_type, description, amount, effective_date,
    status, completed_by, completed_at, created_by
  ) VALUES (
    v_tenant, _incident_id, _employee_id, _action_type, _description,
    COALESCE(_amount,0), _effective_date,
    v_status, v_completed_by, v_completed_at, auth.uid()
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.add_employee_incident_action(uuid,uuid,text,text,numeric,date) TO authenticated;