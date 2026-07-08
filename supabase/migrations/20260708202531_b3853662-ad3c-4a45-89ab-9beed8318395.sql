
-- 1) Drop obsolete overload if it still exists
DROP FUNCTION IF EXISTS public.get_client_portal_tracking(uuid);

-- 2) Fix RH incident audit to recognize both 'hr' and legacy 'rh'
CREATE OR REPLACE FUNCTION public.audit_data_consistency_v2(_tenant_id uuid)
RETURNS TABLE(severity text, domain text, entity_type text, entity_id uuid, message text, suggested_action text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_tenant_admin(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  RETURN QUERY
  SELECT 'warning'::text, 'employees'::text, 'employee'::text, e.id,
    'Funcionário ativo sem contrato ativo: ' || e.name,
    'Criar/ativar contrato em employee_contracts.'::text
  FROM public.employees e
  WHERE e.tenant_id=_tenant_id AND COALESCE(e.status,'active')='active'
    AND NOT EXISTS (SELECT 1 FROM public.employee_contracts c
                    WHERE c.employee_id=e.id AND c.active=true);

  RETURN QUERY
  SELECT 'critical'::text, 'employees'::text, 'employee'::text, e.id,
    'Funcionário com múltiplos contratos ativos: ' || e.name,
    'Manter apenas um contrato ativo por funcionário.'::text
  FROM public.employees e
  JOIN public.employee_contracts c ON c.employee_id=e.id AND c.active=true
  WHERE e.tenant_id=_tenant_id
  GROUP BY e.id, e.name HAVING COUNT(*) > 1;

  RETURN QUERY
  SELECT 'warning'::text, 'drivers'::text, 'driver_settlement'::text, ds.id,
    'Acerto de motorista sem funcionário vinculado (driver_id=' || ds.driver_id::text || ')',
    'Vincular funcionário ao motorista para folha.'::text
  FROM public.driver_settlements ds
  WHERE ds.tenant_id=_tenant_id AND ds.status IN ('approved','paid','closed')
    AND NOT EXISTS (SELECT 1 FROM public.employees e
                    WHERE e.tenant_id=_tenant_id AND e.driver_id=ds.driver_id);

  RETURN QUERY
  SELECT 'warning'::text, 'payroll'::text, 'payroll_entry'::text, pe.id,
    'Entrada de folha sem itens', 'Recalcular período.'::text
  FROM public.payroll_entries pe
  WHERE pe.tenant_id=_tenant_id
    AND NOT EXISTS (SELECT 1 FROM public.payroll_entry_items i WHERE i.payroll_entry_id=pe.id);

  RETURN QUERY
  SELECT 'critical'::text, 'payroll'::text, 'payroll_entry'::text, pe.id,
    'Totais da entrada divergem da soma dos itens',
    'Executar recompute_payroll_entry_totals.'::text
  FROM public.payroll_entries pe
  LEFT JOIN (
    SELECT payroll_entry_id,
           COALESCE(SUM(amount) FILTER (WHERE nature='credit'),0) AS g,
           COALESCE(SUM(amount) FILTER (WHERE nature='debit'),0)  AS d,
           COALESCE(SUM(amount) FILTER (WHERE nature='already_paid'),0) AS p
    FROM public.payroll_entry_items GROUP BY payroll_entry_id
  ) s ON s.payroll_entry_id=pe.id
  WHERE pe.tenant_id=_tenant_id
    AND (pe.gross_amount <> COALESCE(s.g,0)
      OR pe.discount_amount <> COALESCE(s.d,0)
      OR pe.already_paid_amount <> COALESCE(s.p,0));

  RETURN QUERY
  SELECT 'critical'::text, 'finance'::text, 'payroll_entry'::text, pe.id,
    'Entrada de folha aprovada com saldo a pagar sem payable vinculado',
    'Reprocessar approve_payroll_period ou criar payable manual.'::text
  FROM public.payroll_entries pe
  JOIN public.payroll_periods pp ON pp.id=pe.payroll_period_id
  WHERE pe.tenant_id=_tenant_id AND pp.status='approved' AND pe.amount_to_pay > 0
    AND NOT EXISTS (SELECT 1 FROM public.payables pay
                    WHERE pay.tenant_id=_tenant_id
                      AND pay.source_table='payroll_entries'
                      AND pay.source_id=pe.id);

  RETURN QUERY
  SELECT 'critical'::text, 'finance'::text, 'payable'::text, pay.source_id,
    'Múltiplos payables para mesma entrada de folha',
    'Consolidar registros duplicados.'::text
  FROM public.payables pay
  WHERE pay.tenant_id=_tenant_id AND pay.source_table='payroll_entries'
  GROUP BY pay.source_id HAVING COUNT(*) > 1;

  RETURN QUERY
  SELECT 'warning'::text, 'finance'::text, 'employee_advance'::text, a.id,
    'Adiantamento vinculado a payable pago sem status paid',
    'Sincronizar adiantamento com payable.'::text
  FROM public.employee_advances a
  JOIN public.payables pay ON pay.id = a.payable_id
  WHERE a.tenant_id=_tenant_id AND pay.status='paid' AND a.status <> 'paid';

  RETURN QUERY
  SELECT 'info'::text, 'portal'::text, 'client_portal_access'::text, cpa.id,
    'Acesso de portal ativo sem nenhuma permissão útil',
    'Revisar permissões do usuário.'::text
  FROM public.client_portal_access cpa
  WHERE cpa.tenant_id=_tenant_id AND cpa.active=true
    AND NOT (cpa.can_view_financial OR cpa.can_download_documents
             OR cpa.can_open_occurrences OR cpa.can_request_pickup
             OR cpa.can_view_vehicle_live OR cpa.can_view_driver_contact);

  -- Ocorrência de RH sem employee/driver (aceita 'hr' e legado 'rh')
  RETURN QUERY
  SELECT 'warning'::text, 'incidents'::text, 'incident'::text, i.id,
    'Ocorrência de RH sem employee_id nem driver_id',
    'Vincular funcionário ou motorista responsável.'::text
  FROM public.incidents i
  WHERE i.tenant_id=_tenant_id AND i.category IN ('hr','rh')
    AND i.employee_id IS NULL AND i.driver_id IS NULL;

  RETURN;
END;
$function$;

-- 3) RPC: add_employee_incident_action
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
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_emp_tenant uuid;
  v_new_id uuid;
  v_allowed text[] := ARRAY['note','verbal_warning','written_warning','suspension',
                            'training_required','payroll_discount','document_request',
                            'termination_recommendation','other'];
BEGIN
  IF _action_type IS NULL OR NOT (_action_type = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'invalid_action_type';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.incidents WHERE id=_incident_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'incident_not_found'; END IF;

  IF NOT public.is_tenant_member(v_tenant) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT tenant_id INTO v_emp_tenant FROM public.employees WHERE id=_employee_id;
  IF v_emp_tenant IS NULL OR v_emp_tenant <> v_tenant THEN
    RAISE EXCEPTION 'employee_tenant_mismatch';
  END IF;

  IF _action_type = 'payroll_discount' AND COALESCE(_amount,0) <= 0 THEN
    RAISE EXCEPTION 'amount_required_for_discount';
  END IF;

  INSERT INTO public.employee_incident_actions(
    tenant_id, incident_id, employee_id, action_type, description, amount, effective_date, created_by
  ) VALUES (
    v_tenant, _incident_id, _employee_id, _action_type, _description,
    COALESCE(_amount,0), _effective_date, auth.uid()
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.add_employee_incident_action(uuid,uuid,text,text,numeric,date) TO authenticated;
