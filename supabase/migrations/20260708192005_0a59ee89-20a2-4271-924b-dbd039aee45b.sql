
-- ============================================================
-- 1) payables: source_table/source_id/source_metadata + índice
-- ============================================================
ALTER TABLE public.payables
  ADD COLUMN IF NOT EXISTS source_table text,
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payables_source_category
  ON public.payables(tenant_id, source_table, source_id, category)
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL;

-- ============================================================
-- 2) payroll_generation_issues
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payroll_generation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  payroll_period_id uuid,
  issue_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  employee_id uuid,
  driver_id uuid,
  source_table text,
  source_id uuid,
  message text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_generation_issues TO authenticated;
GRANT ALL ON public.payroll_generation_issues TO service_role;

ALTER TABLE public.payroll_generation_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payroll_issues_tenant_read" ON public.payroll_generation_issues;
CREATE POLICY "payroll_issues_tenant_read" ON public.payroll_generation_issues
  FOR SELECT TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id));

DROP POLICY IF EXISTS "payroll_issues_tenant_write" ON public.payroll_generation_issues;
CREATE POLICY "payroll_issues_tenant_write" ON public.payroll_generation_issues
  FOR ALL TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_payroll_issues_period ON public.payroll_generation_issues(payroll_period_id);

-- ============================================================
-- 3) generate_payroll_period — corrigir colunas reais
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_payroll_period(
  _tenant_id uuid, _period_start date, _period_end date,
  _period_name text DEFAULT NULL::text,
  _include_drivers boolean DEFAULT true,
  _include_non_drivers boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $function$
DECLARE
  _period_id uuid;
  _emp record;
  _entry_id uuid;
  _user uuid := auth.uid();
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _period_end < _period_start THEN
    RAISE EXCEPTION 'período final anterior ao inicial';
  END IF;

  SELECT id INTO _period_id
  FROM public.payroll_periods
  WHERE tenant_id = _tenant_id
    AND period_start = _period_start
    AND period_end = _period_end
    AND status IN ('draft','calculated')
  LIMIT 1;

  IF _period_id IS NULL THEN
    INSERT INTO public.payroll_periods(tenant_id, period_name, period_start, period_end,
      competence_month, include_drivers, include_non_drivers, status, created_by)
    VALUES (_tenant_id,
      COALESCE(_period_name, 'Folha ' || to_char(_period_start,'DD/MM/YYYY') || ' - ' || to_char(_period_end,'DD/MM/YYYY')),
      _period_start, _period_end, date_trunc('month', _period_start)::date,
      _include_drivers, _include_non_drivers, 'draft', _user)
    RETURNING id INTO _period_id;
  END IF;

  -- Limpar issues antigas deste período
  DELETE FROM public.payroll_generation_issues WHERE payroll_period_id = _period_id AND NOT resolved;

  -- Registrar acertos aprovados/pagos de motoristas sem funcionário vinculado
  INSERT INTO public.payroll_generation_issues(tenant_id, payroll_period_id, issue_type, severity,
    driver_id, source_table, source_id, message)
  SELECT _tenant_id, _period_id, 'driver_without_employee', 'warning',
    ds.driver_id, 'driver_settlements', ds.id,
    'Motorista com acerto no período mas sem funcionário vinculado (driver_id=' || ds.driver_id::text || ')'
  FROM public.driver_settlements ds
  WHERE ds.tenant_id = _tenant_id
    AND ds.status IN ('approved','paid','closed')
    AND COALESCE(ds.trip_completed_at::date, ds.created_at::date) BETWEEN _period_start AND _period_end
    AND NOT EXISTS (
      SELECT 1 FROM public.employees e WHERE e.tenant_id = _tenant_id AND e.driver_id = ds.driver_id
    );

  FOR _emp IN
    SELECT e.id AS employee_id, e.driver_id, e.name,
           c.id AS contract_id, c.contract_type, c.base_salary
    FROM public.employees e
    LEFT JOIN public.employee_contracts c
      ON c.employee_id = e.id AND c.active = true AND c.tenant_id = _tenant_id
    WHERE e.tenant_id = _tenant_id
      AND (
        (_include_drivers AND e.driver_id IS NOT NULL)
        OR (_include_non_drivers AND e.driver_id IS NULL)
      )
      AND (e.status IS NULL OR e.status IN ('active','on_leave'))
  LOOP
    INSERT INTO public.payroll_entries(tenant_id, payroll_period_id, employee_id,
      driver_id, contract_id, entry_type, status, created_by)
    VALUES (_tenant_id, _period_id, _emp.employee_id, _emp.driver_id, _emp.contract_id,
      CASE WHEN _emp.driver_id IS NOT NULL THEN 'driver' ELSE 'employee' END,
      'draft', _user)
    ON CONFLICT (payroll_period_id, employee_id) DO NOTHING
    RETURNING id INTO _entry_id;

    IF _entry_id IS NULL THEN
      SELECT id INTO _entry_id FROM public.payroll_entries
        WHERE payroll_period_id = _period_id AND employee_id = _emp.employee_id;
    END IF;

    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.payroll_entries WHERE id = _entry_id AND status IN ('approved','locked','cancelled')
    );

    -- Wipe previously auto-generated items (keep manual ones)
    DELETE FROM public.payroll_entry_items
     WHERE payroll_entry_id = _entry_id
       AND item_type NOT IN ('manual_credit','manual_debit');

    IF _emp.contract_id IS NULL THEN
      INSERT INTO public.payroll_generation_issues(tenant_id, payroll_period_id, issue_type, severity,
        employee_id, driver_id, message)
      VALUES (_tenant_id, _period_id, 'employee_without_contract', 'warning',
        _emp.employee_id, _emp.driver_id,
        'Funcionário ativo sem contrato ativo: ' || _emp.name);
    END IF;

    -- 1) Base salary
    IF _emp.contract_id IS NOT NULL AND COALESCE(_emp.base_salary,0) > 0 THEN
      INSERT INTO public.payroll_entry_items(tenant_id, payroll_period_id, payroll_entry_id,
        employee_id, driver_id, item_type, nature, description, amount,
        source_table, source_id, competence_date, created_by)
      VALUES (_tenant_id, _period_id, _entry_id, _emp.employee_id, _emp.driver_id,
        'base_salary','credit','Salário base do contrato', _emp.base_salary,
        'employee_contracts', _emp.contract_id, _period_start, _user);
    END IF;

    -- 2) Advances paid within period
    INSERT INTO public.payroll_entry_items(tenant_id, payroll_period_id, payroll_entry_id,
      employee_id, driver_id, item_type, nature, description, amount,
      source_table, source_id, competence_date, created_by)
    SELECT _tenant_id, _period_id, _entry_id, _emp.employee_id, _emp.driver_id,
      'driver_advance', 'already_paid',
      'Adiantamento ' || to_char(a.advance_date,'DD/MM/YYYY') || COALESCE(' — '||a.reason,''),
      a.amount,
      'employee_advances', a.id, a.advance_date, _user
    FROM public.employee_advances a
    WHERE a.tenant_id = _tenant_id
      AND a.employee_id = _emp.employee_id
      AND a.status = 'paid'
      AND a.advance_date BETWEEN _period_start AND _period_end;

    -- 3) Incident payroll discounts
    INSERT INTO public.payroll_entry_items(tenant_id, payroll_period_id, payroll_entry_id,
      employee_id, driver_id, item_type, nature, description, amount,
      source_table, source_id, competence_date, created_by)
    SELECT _tenant_id, _period_id, _entry_id, _emp.employee_id, _emp.driver_id,
      'incident_discount', 'debit',
      'Desconto ocorrência' || COALESCE(' — '||ia.description,''),
      ia.amount,
      'employee_incident_actions', ia.id, COALESCE(ia.effective_date, _period_start), _user
    FROM public.employee_incident_actions ia
    WHERE ia.tenant_id = _tenant_id
      AND ia.employee_id = _emp.employee_id
      AND ia.action_type = 'payroll_discount'
      AND ia.status = 'completed'
      AND ia.amount > 0
      AND COALESCE(ia.effective_date, ia.created_at::date) BETWEEN _period_start AND _period_end;

    -- 4) Driver-linked sources
    IF _emp.driver_id IS NOT NULL THEN
      -- Acertos aprovados/pagos/fechados no período como crédito
      INSERT INTO public.payroll_entry_items(tenant_id, payroll_period_id, payroll_entry_id,
        employee_id, driver_id, item_type, nature, description, amount,
        source_table, source_id, competence_date, created_by)
      SELECT _tenant_id, _period_id, _entry_id, _emp.employee_id, _emp.driver_id,
        'driver_settlement', 'credit',
        'Acerto motorista #' || substring(ds.id::text, 1, 8) ||
          COALESCE(' — ' || ds.route_name, ''),
        COALESCE(ds.driver_payable_amount, ds.final_amount, 0),
        'driver_settlements', ds.id,
        COALESCE(ds.trip_completed_at::date, ds.created_at::date), _user
      FROM public.driver_settlements ds
      WHERE ds.tenant_id = _tenant_id
        AND ds.driver_id = _emp.driver_id
        AND ds.status IN ('approved','paid','closed')
        AND COALESCE(ds.trip_completed_at::date, ds.created_at::date) BETWEEN _period_start AND _period_end
        AND COALESCE(ds.driver_payable_amount, ds.final_amount, 0) > 0;

      -- Pagamentos de acerto como already_paid
      INSERT INTO public.payroll_entry_items(tenant_id, payroll_period_id, payroll_entry_id,
        employee_id, driver_id, item_type, nature, description, amount,
        source_table, source_id, competence_date, created_by)
      SELECT _tenant_id, _period_id, _entry_id, _emp.employee_id, _emp.driver_id,
        'driver_settlement_payment', 'already_paid',
        'Pagamento acerto ' || to_char(dsp.paid_at::date,'DD/MM/YYYY'),
        dsp.amount,
        'driver_settlement_payments', dsp.id, dsp.paid_at::date, _user
      FROM public.driver_settlement_payments dsp
      JOIN public.driver_settlements ds ON ds.id = dsp.settlement_id
      WHERE dsp.tenant_id = _tenant_id
        AND ds.driver_id = _emp.driver_id
        AND dsp.paid_at IS NOT NULL
        AND dsp.paid_at::date BETWEEN _period_start AND _period_end;

      -- Despesas de motorista aprovadas reembolsáveis
      INSERT INTO public.payroll_entry_items(tenant_id, payroll_period_id, payroll_entry_id,
        employee_id, driver_id, item_type, nature, description, amount,
        source_table, source_id, competence_date, created_by)
      SELECT _tenant_id, _period_id, _entry_id, _emp.employee_id, _emp.driver_id,
        'driver_expense_reimbursement', 'credit',
        'Reembolso despesa ' || COALESCE(de.category::text, ''),
        de.amount,
        'driver_expenses', de.id,
        COALESCE(de.expense_at::date, de.created_at::date), _user
      FROM public.driver_expenses de
      WHERE de.tenant_id = _tenant_id
        AND de.driver_id = _emp.driver_id
        AND COALESCE(de.reimbursable, false) = true
        AND de.approval_status = 'approved'
        AND COALESCE(de.paid_with_advance, false) = false
        AND COALESCE(de.expense_at::date, de.created_at::date) BETWEEN _period_start AND _period_end;
    END IF;

    PERFORM public.recompute_payroll_entry_totals(_entry_id);
    UPDATE public.payroll_entries SET status = 'calculated' WHERE id = _entry_id AND status = 'draft';
  END LOOP;

  UPDATE public.payroll_periods SET status = 'calculated', updated_at = now()
    WHERE id = _period_id AND status = 'draft';

  RETURN _period_id;
END;
$function$;

-- ============================================================
-- 4) approve_payroll_period — usar source_table/source_id em payables
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_payroll_period(_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $function$
DECLARE
  _tenant uuid;
  _pstart date;
  _pend date;
  _entry record;
  _user uuid := auth.uid();
BEGIN
  SELECT tenant_id, period_start, period_end INTO _tenant, _pstart, _pend
    FROM public.payroll_periods WHERE id = _period_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'período não encontrado'; END IF;
  IF NOT public.is_tenant_operator_or_admin(_tenant) THEN RAISE EXCEPTION 'not authorized'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payroll_entries WHERE payroll_period_id = _period_id) THEN
    RAISE EXCEPTION 'período sem entradas';
  END IF;

  -- Validar duplicidade motorista: acerto já com payable externo pago fora da folha
  INSERT INTO public.payroll_generation_issues(tenant_id, payroll_period_id, issue_type, severity,
    driver_id, source_table, source_id, message)
  SELECT _tenant, _period_id, 'settlement_paid_outside_payroll', 'warning',
    ds.driver_id, 'driver_settlements', ds.id,
    'Acerto ' || substring(ds.id::text,1,8) || ' já possui pagamentos externos fora desta folha'
  FROM public.driver_settlements ds
  WHERE ds.tenant_id = _tenant
    AND EXISTS (
      SELECT 1 FROM public.payroll_entry_items i
      WHERE i.payroll_period_id = _period_id
        AND i.source_table = 'driver_settlements' AND i.source_id = ds.id
    )
    AND EXISTS (
      SELECT 1 FROM public.driver_settlement_payments dsp
      WHERE dsp.settlement_id = ds.id AND dsp.paid_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.payroll_entry_items ii
          WHERE ii.payroll_period_id = _period_id
            AND ii.source_table = 'driver_settlement_payments' AND ii.source_id = dsp.id
        )
    );

  FOR _entry IN SELECT id FROM public.payroll_entries WHERE payroll_period_id = _period_id LOOP
    PERFORM public.recompute_payroll_entry_totals(_entry.id);
  END LOOP;
  UPDATE public.payroll_entry_items SET locked = true WHERE payroll_period_id = _period_id;
  UPDATE public.payroll_entries SET status = 'approved' WHERE payroll_period_id = _period_id AND status <> 'cancelled';

  -- Gerar payables vinculados por source
  FOR _entry IN
    SELECT e.id, e.employee_id, e.driver_id, e.amount_to_pay, emp.name AS employee_name
    FROM public.payroll_entries e
    JOIN public.employees emp ON emp.id = e.employee_id
    WHERE e.payroll_period_id = _period_id
      AND e.amount_to_pay > 0
      AND e.status <> 'cancelled'
  LOOP
    INSERT INTO public.payables(tenant_id, supplier_name, category, description, amount,
      competence_date, due_date, driver_id, status, created_by,
      source_table, source_id, source_metadata, notes)
    VALUES (_tenant, _entry.employee_name, 'payroll',
      'Folha ' || to_char(_pstart,'DD/MM/YYYY') || '–' || to_char(_pend,'DD/MM/YYYY') || ' — ' || _entry.employee_name,
      _entry.amount_to_pay, _pstart, _pend, _entry.driver_id, 'pending', _user,
      'payroll_entries', _entry.id,
      jsonb_build_object('payroll_period_id', _period_id, 'employee_id', _entry.employee_id),
      NULL)
    ON CONFLICT (tenant_id, source_table, source_id, category) DO NOTHING;
  END LOOP;

  UPDATE public.payroll_periods
     SET status = 'approved', approved_by = _user, approved_at = now(), updated_at = now()
   WHERE id = _period_id;
END;
$function$;

-- ============================================================
-- 5) Bloqueio de alteração em itens de folha aprovada/fechada
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_payroll_items_locked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _pstatus text;
  _estatus text;
  _pid uuid;
  _eid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _pid := OLD.payroll_period_id; _eid := OLD.payroll_entry_id;
  ELSE
    _pid := NEW.payroll_period_id; _eid := NEW.payroll_entry_id;
  END IF;

  SELECT status INTO _pstatus FROM public.payroll_periods WHERE id = _pid;
  SELECT status INTO _estatus FROM public.payroll_entries WHERE id = _eid;

  IF _pstatus IN ('approved','closed','cancelled') THEN
    RAISE EXCEPTION 'período de folha % está %; itens não podem ser modificados', _pid, _pstatus;
  END IF;
  IF _estatus IN ('approved','locked','cancelled') THEN
    RAISE EXCEPTION 'entrada de folha % está %; itens não podem ser modificados', _eid, _estatus;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_items_locked ON public.payroll_entry_items;
CREATE TRIGGER trg_payroll_items_locked
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_entry_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_payroll_items_locked();

-- ============================================================
-- 6) RPCs de ajuste manual controlado (bypass do lock só via RPC)
-- ============================================================
-- Manter simples: apenas expostas; a inserção real desabilita o trigger via SECURITY DEFINER
  SET search_path = public + session_replication_role
CREATE OR REPLACE FUNCTION public.add_payroll_manual_item(
  _entry_id uuid, _nature text, _description text, _amount numeric, _reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _tenant uuid; _period uuid; _emp uuid; _drv uuid; _pstatus text; _estatus text; _new uuid;
BEGIN
  SELECT tenant_id, payroll_period_id, employee_id, driver_id, status
    INTO _tenant, _period, _emp, _drv, _estatus
    FROM public.payroll_entries WHERE id = _entry_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'entry not found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(_tenant) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT status INTO _pstatus FROM public.payroll_periods WHERE id = _period;
  IF _pstatus IN ('approved','closed','cancelled') THEN
    RAISE EXCEPTION 'período %; não permite ajuste manual', _pstatus;
  END IF;
  IF _estatus IN ('approved','locked','cancelled') THEN
    RAISE EXCEPTION 'entrada %; não permite ajuste manual', _estatus;
  END IF;
  IF _nature NOT IN ('credit','debit') THEN RAISE EXCEPTION 'nature inválida'; END IF;
  IF COALESCE(_reason,'') = '' THEN RAISE EXCEPTION 'motivo obrigatório'; END IF;

  INSERT INTO public.payroll_entry_items(tenant_id, payroll_period_id, payroll_entry_id,
    employee_id, driver_id, item_type, nature, description, amount,
    source_table, source_id, source_metadata, competence_date, created_by)
  VALUES (_tenant, _period, _entry_id, _emp, _drv,
    CASE WHEN _nature='credit' THEN 'manual_credit' ELSE 'manual_debit' END,
    _nature, _description, _amount,
    NULL, NULL, jsonb_build_object('reason', _reason, 'created_by', auth.uid()),
    CURRENT_DATE, auth.uid())
  RETURNING id INTO _new;

  PERFORM public.recompute_payroll_entry_totals(_entry_id);
  RETURN _new;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_payroll_entry_item(_item_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _tenant uuid; _period uuid; _entry uuid; _pstatus text; _estatus text; _locked boolean;
BEGIN
  SELECT tenant_id, payroll_period_id, payroll_entry_id, locked
    INTO _tenant, _period, _entry, _locked
    FROM public.payroll_entry_items WHERE id = _item_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'item not found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(_tenant) THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT status INTO _pstatus FROM public.payroll_periods WHERE id = _period;
  SELECT status INTO _estatus FROM public.payroll_entries WHERE id = _entry;
  IF _pstatus IN ('approved','closed','cancelled') OR _estatus IN ('approved','locked','cancelled') OR _locked THEN
    RAISE EXCEPTION 'item bloqueado';
  END IF;
  IF COALESCE(_reason,'') = '' THEN RAISE EXCEPTION 'motivo obrigatório'; END IF;

  DELETE FROM public.payroll_entry_items WHERE id = _item_id;
  PERFORM public.recompute_payroll_entry_totals(_entry);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_payroll_manual_item(uuid,text,text,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_payroll_entry_item(uuid,text) TO authenticated;

-- ============================================================
-- 7) Sincronizar employee_advances quando payable vinculado muda
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_employee_advance_from_payable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'paid' THEN
      UPDATE public.employee_advances
         SET status = 'paid', paid_at = COALESCE(NEW.paid_at, now()), updated_at = now()
       WHERE payable_id = NEW.id AND status <> 'paid';
    ELSIF NEW.status = 'cancelled' THEN
      UPDATE public.employee_advances
         SET status = 'cancelled', updated_at = now()
       WHERE payable_id = NEW.id AND status <> 'cancelled';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_employee_advance ON public.payables;
CREATE TRIGGER trg_sync_employee_advance
AFTER UPDATE ON public.payables
FOR EACH ROW EXECUTE FUNCTION public.sync_employee_advance_from_payable();

-- ============================================================
-- 8) get_client_portal_tracking — colunas reais + _client_id
-- ============================================================
DROP FUNCTION IF EXISTS public.get_client_portal_tracking(uuid);
CREATE OR REPLACE FUNCTION public.get_client_portal_tracking(
  _tenant_id uuid, _client_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF _client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.client_portal_access
    WHERE tenant_id=_tenant_id AND user_id=auth.uid() AND active=true AND client_id=_client_id
  ) THEN
    RAISE EXCEPTION 'not authorized for client';
  END IF;

  WITH allowed AS (
    SELECT client_id,
           bool_or(can_view_vehicle_live)   AS can_vehicle,
           bool_or(can_view_driver_contact) AS can_driver
    FROM public.client_portal_access
    WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true
      AND (_client_id IS NULL OR client_id = _client_id)
    GROUP BY client_id
  ),
  base AS (
    SELECT DISTINCT
      l.id AS load_id, l.load_number, l.status, l.updated_at,
      fd.client_id, a.can_vehicle, a.can_driver
    FROM public.fiscal_documents fd
    JOIN allowed a ON a.client_id = fd.client_id
    JOIN public.loads l ON l.id = fd.load_id
    WHERE fd.tenant_id = _tenant_id
      AND l.status IN ('planned','in_transit','arrived','loading','out_for_delivery')
  ),
  enriched AS (
    SELECT
      b.*,
      dt.id AS trip_id, dt.vehicle_id, dt.driver_id,
      dt.actual_start_at, dt.planned_end_at,
      v.plate, v.nickname AS vehicle_nickname,
      d.name AS driver_name, d.phone AS driver_phone,
      pl.lat, pl.lng, pl.speed, pl.captured_at,
      (SELECT jsonb_build_object(
          'id', ds.id,
          'sequence', ds.stop_order,
          'destination', ds.destination,
          'city', NULL::text,
          'state', NULL::text,
          'planned_arrival_at', ds.planned_arrival_at
        )
        FROM public.dispatch_stops ds
        WHERE ds.dispatch_trip_id = dt.id
          AND ds.actual_departure_at IS NULL
        ORDER BY ds.stop_order ASC
        LIMIT 1) AS next_stop
    FROM base b
    LEFT JOIN public.dispatch_trip_loads dtl ON dtl.load_id = b.load_id
    LEFT JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id
    LEFT JOIN public.vehicles v ON v.id = dt.vehicle_id
    LEFT JOIN public.drivers d ON d.id = dt.driver_id
    LEFT JOIN public.positions_last pl
      ON pl.tenant_id = _tenant_id AND pl.vehicle_id = dt.vehicle_id
  )
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(
      jsonb_build_object(
        'load_id', load_id,
        'load_number', load_number,
        'status', status,
        'updated_at', updated_at,
        'client_id', client_id,
        'trip_id', trip_id,
        'plate',            CASE WHEN can_vehicle THEN plate ELSE NULL END,
        'vehicle_nickname', CASE WHEN can_vehicle THEN vehicle_nickname ELSE NULL END,
        'lat',              CASE WHEN can_vehicle THEN lat ELSE NULL END,
        'lng',              CASE WHEN can_vehicle THEN lng ELSE NULL END,
        'speed',            CASE WHEN can_vehicle THEN speed ELSE NULL END,
        'captured_at',      CASE WHEN can_vehicle THEN captured_at ELSE NULL END,
        'driver_name',      CASE WHEN can_driver  THEN driver_name ELSE NULL END,
        'driver_phone',     CASE WHEN can_driver  THEN driver_phone ELSE NULL END,
        'actual_start_at',  actual_start_at,
        'planned_end_at',   planned_end_at,
        'next_stop', next_stop,
        'can_view_vehicle_live', can_vehicle,
        'can_view_driver_contact', can_driver
      ) ORDER BY updated_at DESC
    ), '[]'::jsonb)
  ) INTO v_result
  FROM enriched;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_client_portal_tracking(uuid,uuid) TO authenticated;

-- ============================================================
-- 9) audit_data_consistency_v2 — cobrindo novos domínios
-- ============================================================
CREATE OR REPLACE FUNCTION public.audit_data_consistency_v2(_tenant_id uuid)
RETURNS TABLE(
  severity text, domain text, entity_type text, entity_id uuid,
  message text, suggested_action text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $function$
BEGIN
  IF NOT public.is_tenant_admin(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- RH: funcionário ativo sem contrato ativo
  RETURN QUERY
  SELECT 'warning'::text, 'employees'::text, 'employee'::text, e.id,
    'Funcionário ativo sem contrato ativo: ' || e.name,
    'Criar/ativar contrato em employee_contracts.'::text
  FROM public.employees e
  WHERE e.tenant_id=_tenant_id AND COALESCE(e.status,'active')='active'
    AND NOT EXISTS (SELECT 1 FROM public.employee_contracts c
                    WHERE c.employee_id=e.id AND c.active=true);

  -- RH: funcionário com múltiplos contratos ativos
  RETURN QUERY
  SELECT 'critical'::text, 'employees'::text, 'employee'::text, e.id,
    'Funcionário com múltiplos contratos ativos: ' || e.name,
    'Manter apenas um contrato ativo por funcionário.'::text
  FROM public.employees e
  JOIN public.employee_contracts c ON c.employee_id=e.id AND c.active=true
  WHERE e.tenant_id=_tenant_id
  GROUP BY e.id, e.name HAVING COUNT(*) > 1;

  -- Motorista com acerto sem funcionário
  RETURN QUERY
  SELECT 'warning'::text, 'drivers'::text, 'driver_settlement'::text, ds.id,
    'Acerto de motorista sem funcionário vinculado (driver_id=' || ds.driver_id::text || ')',
    'Vincular funcionário ao motorista para folha.'::text
  FROM public.driver_settlements ds
  WHERE ds.tenant_id=_tenant_id AND ds.status IN ('approved','paid','closed')
    AND NOT EXISTS (SELECT 1 FROM public.employees e
                    WHERE e.tenant_id=_tenant_id AND e.driver_id=ds.driver_id);

  -- Folha: entry sem itens
  RETURN QUERY
  SELECT 'warning'::text, 'payroll'::text, 'payroll_entry'::text, pe.id,
    'Entrada de folha sem itens', 'Recalcular período.'::text
  FROM public.payroll_entries pe
  WHERE pe.tenant_id=_tenant_id
    AND NOT EXISTS (SELECT 1 FROM public.payroll_entry_items i WHERE i.payroll_entry_id=pe.id);

  -- Folha: totais divergentes
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

  -- Folha aprovada sem payable
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

  -- Payable duplicado para mesma entrada
  RETURN QUERY
  SELECT 'critical'::text, 'finance'::text, 'payable'::text, pay.source_id,
    'Múltiplos payables para mesma entrada de folha',
    'Consolidar registros duplicados.'::text
  FROM public.payables pay
  WHERE pay.tenant_id=_tenant_id AND pay.source_table='payroll_entries'
  GROUP BY pay.source_id HAVING COUNT(*) > 1;

  -- Adiantamento vinculado a payable pago mas não paid
  RETURN QUERY
  SELECT 'warning'::text, 'finance'::text, 'employee_advance'::text, a.id,
    'Adiantamento vinculado a payable pago sem status paid',
    'Sincronizar adiantamento com payable.'::text
  FROM public.employee_advances a
  JOIN public.payables pay ON pay.id = a.payable_id
  WHERE a.tenant_id=_tenant_id AND pay.status='paid' AND a.status <> 'paid';

  -- Portal: acesso ativo sem permissões úteis
  RETURN QUERY
  SELECT 'info'::text, 'portal'::text, 'client_portal_access'::text, cpa.id,
    'Acesso de portal ativo sem nenhuma permissão útil',
    'Revisar permissões do usuário.'::text
  FROM public.client_portal_access cpa
  WHERE cpa.tenant_id=_tenant_id AND cpa.active=true
    AND NOT (cpa.can_view_financial OR cpa.can_download_documents
             OR cpa.can_open_occurrences OR cpa.can_request_pickup
             OR cpa.can_view_vehicle_live OR cpa.can_view_driver_contact);

  -- Ocorrência de RH sem employee/driver
  RETURN QUERY
  SELECT 'warning'::text, 'incidents'::text, 'incident'::text, i.id,
    'Ocorrência de RH sem employee_id nem driver_id',
    'Vincular funcionário ou motorista responsável.'::text
  FROM public.incidents i
  WHERE i.tenant_id=_tenant_id AND i.category='rh'
    AND i.employee_id IS NULL AND i.driver_id IS NULL;

  RETURN;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.audit_data_consistency_v2(uuid) TO authenticated;
