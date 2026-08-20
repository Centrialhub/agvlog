
-- =====================================================
-- RH & Folha de Pagamento (aditivo)
-- =====================================================

-- ----------------- employee_contracts -----------------
CREATE TABLE public.employee_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  contract_type text NOT NULL DEFAULT 'employee'
    CHECK (contract_type IN ('employee','driver','contractor','temporary','intern','third_party','other')),
  employment_regime text
    CHECK (employment_regime IS NULL OR employment_regime IN ('clt','pj','autonomous','daily','commission','other')),
  position_title text,
  department text,
  branch text,
  cost_center text,
  start_date date NOT NULL,
  end_date date,
  base_salary numeric(14,2) NOT NULL DEFAULT 0,
  daily_rate numeric(14,2) NOT NULL DEFAULT 0,
  hourly_rate numeric(14,2) NOT NULL DEFAULT 0,
  commission_rate numeric(8,4) NOT NULL DEFAULT 0,
  payment_cycle text NOT NULL DEFAULT 'monthly'
    CHECK (payment_cycle IN ('weekly','biweekly','monthly','per_trip','custom')),
  payment_method text
    CHECK (payment_method IS NULL OR payment_method IN ('pix','bank_transfer','cash','check','other')),
  bank_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_contracts TO authenticated;
GRANT ALL ON public.employee_contracts TO service_role;
ALTER TABLE public.employee_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employee_contracts_select" ON public.employee_contracts
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "employee_contracts_manage" ON public.employee_contracts
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "employee_contracts_update" ON public.employee_contracts
  FOR UPDATE TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "employee_contracts_delete" ON public.employee_contracts
  FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));
CREATE UNIQUE INDEX uq_employee_contracts_active
  ON public.employee_contracts(tenant_id, employee_id) WHERE active = true;
CREATE INDEX idx_employee_contracts_employee ON public.employee_contracts(tenant_id, employee_id);
CREATE TRIGGER trg_employee_contracts_updated_at
  BEFORE UPDATE ON public.employee_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------- payroll_periods --------------------
CREATE TABLE public.payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_name text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  competence_month date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','calculated','under_review','approved','closed','cancelled')),
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','partial','paid')),
  include_drivers boolean NOT NULL DEFAULT true,
  include_non_drivers boolean NOT NULL DEFAULT true,
  notes text,
  approved_by uuid,
  approved_at timestamptz,
  closed_by uuid,
  closed_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_periods TO authenticated;
GRANT ALL ON public.payroll_periods TO service_role;
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payroll_periods_select" ON public.payroll_periods
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "payroll_periods_insert" ON public.payroll_periods
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "payroll_periods_update" ON public.payroll_periods
  FOR UPDATE TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "payroll_periods_delete" ON public.payroll_periods
  FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));
CREATE INDEX idx_payroll_periods_tenant_status ON public.payroll_periods(tenant_id, status, period_start DESC);
CREATE TRIGGER trg_payroll_periods_updated_at
  BEFORE UPDATE ON public.payroll_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------- payroll_entries --------------------
CREATE TABLE public.payroll_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payroll_period_id uuid NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  contract_id uuid REFERENCES public.employee_contracts(id) ON DELETE SET NULL,
  entry_type text NOT NULL DEFAULT 'employee'
    CHECK (entry_type IN ('employee','driver','mixed')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','calculated','approved','locked','cancelled')),
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','partial','paid')),
  gross_amount numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  already_paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  net_amount numeric(14,2) NOT NULL DEFAULT 0,
  amount_to_pay numeric(14,2) NOT NULL DEFAULT 0,
  carryover_amount numeric(14,2) NOT NULL DEFAULT 0,
  source_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_period_id, employee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_entries TO authenticated;
GRANT ALL ON public.payroll_entries TO service_role;
ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payroll_entries_select" ON public.payroll_entries
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "payroll_entries_insert" ON public.payroll_entries
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "payroll_entries_update" ON public.payroll_entries
  FOR UPDATE TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "payroll_entries_delete" ON public.payroll_entries
  FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));
CREATE INDEX idx_payroll_entries_period ON public.payroll_entries(payroll_period_id);
CREATE INDEX idx_payroll_entries_employee ON public.payroll_entries(tenant_id, employee_id);
CREATE INDEX idx_payroll_entries_driver ON public.payroll_entries(tenant_id, driver_id);
CREATE TRIGGER trg_payroll_entries_updated_at
  BEFORE UPDATE ON public.payroll_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------- payroll_entry_items ----------------
CREATE TABLE public.payroll_entry_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payroll_period_id uuid NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  payroll_entry_id uuid NOT NULL REFERENCES public.payroll_entries(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  item_type text NOT NULL
    CHECK (item_type IN (
      'base_salary','daily','hourly','commission','bonus','allowance',
      'driver_settlement','driver_settlement_payment','driver_expense_reimbursement',
      'driver_advance','expense_paid_by_company','incident_discount',
      'manual_credit','manual_debit','other'
    )),
  nature text NOT NULL CHECK (nature IN ('credit','debit','already_paid','info')),
  description text NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  quantity numeric(14,2),
  unit_value numeric(14,2),
  source_table text,
  source_id uuid,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  competence_date date,
  occurred_at timestamptz,
  locked boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_entry_items TO authenticated;
GRANT ALL ON public.payroll_entry_items TO service_role;
ALTER TABLE public.payroll_entry_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payroll_entry_items_select" ON public.payroll_entry_items
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "payroll_entry_items_insert" ON public.payroll_entry_items
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "payroll_entry_items_update" ON public.payroll_entry_items
  FOR UPDATE TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id) AND locked = false)
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "payroll_entry_items_delete" ON public.payroll_entry_items
  FOR DELETE TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id) AND locked = false);
CREATE INDEX idx_payroll_items_entry ON public.payroll_entry_items(payroll_entry_id);
CREATE INDEX idx_payroll_items_period ON public.payroll_entry_items(payroll_period_id);
CREATE UNIQUE INDEX uq_payroll_items_source
  ON public.payroll_entry_items(tenant_id, payroll_entry_id, item_type, source_table, source_id)
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL;

-- ----------------- employee_advances ------------------
CREATE TABLE public.employee_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  advance_date date NOT NULL DEFAULT current_date,
  reason text,
  payment_method text,
  payment_reference text,
  payable_id uuid REFERENCES public.payables(id) ON DELETE SET NULL,
  financial_obligation_id uuid REFERENCES public.financial_obligations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','paid','cancelled')),
  approved_by uuid,
  approved_at timestamptz,
  paid_by uuid,
  paid_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_advances TO authenticated;
GRANT ALL ON public.employee_advances TO service_role;
ALTER TABLE public.employee_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employee_advances_select" ON public.employee_advances
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "employee_advances_insert" ON public.employee_advances
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "employee_advances_update" ON public.employee_advances
  FOR UPDATE TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "employee_advances_delete" ON public.employee_advances
  FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));
CREATE INDEX idx_employee_advances_employee ON public.employee_advances(tenant_id, employee_id, advance_date DESC);
CREATE INDEX idx_employee_advances_status ON public.employee_advances(tenant_id, status);
CREATE TRIGGER trg_employee_advances_updated_at
  BEFORE UPDATE ON public.employee_advances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------- employee_incident_actions ----------
CREATE TABLE public.employee_incident_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  action_type text NOT NULL
    CHECK (action_type IN (
      'note','verbal_warning','written_warning','suspension',
      'training_required','payroll_discount','document_request',
      'termination_recommendation','other'
    )),
  description text,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  effective_date date,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','completed','cancelled')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid,
  completed_at timestamptz,
  CHECK (action_type <> 'payroll_discount' OR amount > 0)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_incident_actions TO authenticated;
GRANT ALL ON public.employee_incident_actions TO service_role;
ALTER TABLE public.employee_incident_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eia_select" ON public.employee_incident_actions
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "eia_insert" ON public.employee_incident_actions
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "eia_update" ON public.employee_incident_actions
  FOR UPDATE TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "eia_delete" ON public.employee_incident_actions
  FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));
CREATE INDEX idx_eia_incident ON public.employee_incident_actions(tenant_id, incident_id);
CREATE INDEX idx_eia_employee ON public.employee_incident_actions(tenant_id, employee_id);

-- =====================================================
-- Helper: recompute totals for one payroll entry
-- =====================================================
CREATE OR REPLACE FUNCTION public.recompute_payroll_entry_totals(_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _gross numeric(14,2) := 0;
  _debit numeric(14,2) := 0;
  _paid  numeric(14,2) := 0;
  _net   numeric(14,2) := 0;
  _to_pay numeric(14,2) := 0;
  _carry numeric(14,2) := 0;
BEGIN
  SELECT COALESCE(SUM(amount) FILTER (WHERE nature='credit'),0),
         COALESCE(SUM(amount) FILTER (WHERE nature='debit'),0),
         COALESCE(SUM(amount) FILTER (WHERE nature='already_paid'),0)
    INTO _gross, _debit, _paid
  FROM public.payroll_entry_items
  WHERE payroll_entry_id = _entry_id;

  _net := _gross - _debit;
  IF _paid > _net THEN
    _carry := _paid - _net;
    _to_pay := 0;
  ELSE
    _carry := 0;
    _to_pay := _net - _paid;
  END IF;

  UPDATE public.payroll_entries
     SET gross_amount = _gross,
         discount_amount = _debit,
         already_paid_amount = _paid,
         net_amount = _net,
         amount_to_pay = _to_pay,
         carryover_amount = _carry,
         updated_at = now()
   WHERE id = _entry_id;
END;
$$;

-- =====================================================
-- RPC: generate_payroll_period
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_payroll_period(
  _tenant_id uuid,
  _period_start date,
  _period_end date,
  _period_name text DEFAULT NULL,
  _include_drivers boolean DEFAULT true,
  _include_non_drivers boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _period_id uuid;
  _emp record;
  _entry_id uuid;
  _contract record;
  _user uuid := auth.uid();
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _period_end < _period_start THEN
    RAISE EXCEPTION 'período final anterior ao inicial';
  END IF;

  -- Reuse existing draft/calculated period matching range, else create
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
      COALESCE(_period_name, 'Folha ' || to_char(_period_start, 'DD/MM/YYYY') || ' - ' || to_char(_period_end, 'DD/MM/YYYY')),
      _period_start, _period_end,
      date_trunc('month', _period_start)::date,
      _include_drivers, _include_non_drivers, 'draft', _user)
    RETURNING id INTO _period_id;
  END IF;

  -- Ensure entries exist for each relevant employee
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
    VALUES (_tenant_id, _period_id, _emp.employee_id,
      _emp.driver_id, _emp.contract_id,
      CASE WHEN _emp.driver_id IS NOT NULL THEN 'driver' ELSE 'employee' END,
      'draft', _user)
    ON CONFLICT (payroll_period_id, employee_id) DO NOTHING
    RETURNING id INTO _entry_id;

    IF _entry_id IS NULL THEN
      SELECT id INTO _entry_id FROM public.payroll_entries
        WHERE payroll_period_id = _period_id AND employee_id = _emp.employee_id;
    END IF;

    -- Skip regenerating items for locked entries
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.payroll_entries WHERE id = _entry_id AND status IN ('approved','locked','cancelled')
    );

    -- Wipe previously auto-generated items (keep manual ones)
    DELETE FROM public.payroll_entry_items
     WHERE payroll_entry_id = _entry_id
       AND item_type NOT IN ('manual_credit','manual_debit');

    -- 1) Base salary from active contract
    IF _emp.contract_id IS NOT NULL AND _emp.base_salary > 0 THEN
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
      AND a.advance_date BETWEEN _period_start AND _period_end
    ON CONFLICT DO NOTHING;

    -- 3) Incident payroll discounts (completed)
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
      AND COALESCE(ia.effective_date, ia.created_at::date) BETWEEN _period_start AND _period_end
    ON CONFLICT DO NOTHING;

    -- 4) Driver-linked sources
    IF _emp.driver_id IS NOT NULL THEN
      -- driver_settlements approved/paid/closed within period as credit
      INSERT INTO public.payroll_entry_items(tenant_id, payroll_period_id, payroll_entry_id,
        employee_id, driver_id, item_type, nature, description, amount,
        source_table, source_id, competence_date, created_by)
      SELECT _tenant_id, _period_id, _entry_id, _emp.employee_id, _emp.driver_id,
        'driver_settlement', 'credit',
        'Acerto motorista ' || COALESCE(ds.settlement_number::text, ds.id::text),
        COALESCE(ds.net_amount, ds.total_amount, 0),
        'driver_settlements', ds.id, COALESCE(ds.period_end, _period_end), _user
      FROM public.driver_settlements ds
      WHERE ds.tenant_id = _tenant_id
        AND ds.driver_id = _emp.driver_id
        AND ds.status IN ('approved','paid','closed')
        AND COALESCE(ds.period_end, ds.created_at::date) BETWEEN _period_start AND _period_end
      ON CONFLICT DO NOTHING;

      -- driver_settlement_payments as already_paid
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
        AND dsp.paid_at::date BETWEEN _period_start AND _period_end
      ON CONFLICT DO NOTHING;

      -- driver_expenses reimbursable approved
      INSERT INTO public.payroll_entry_items(tenant_id, payroll_period_id, payroll_entry_id,
        employee_id, driver_id, item_type, nature, description, amount,
        source_table, source_id, competence_date, created_by)
      SELECT _tenant_id, _period_id, _entry_id, _emp.employee_id, _emp.driver_id,
        'driver_expense_reimbursement', 'credit',
        'Reembolso despesa ' || COALESCE(de.category::text, ''),
        de.amount,
        'driver_expenses', de.id, COALESCE(de.expense_date, _period_start), _user
      FROM public.driver_expenses de
      WHERE de.tenant_id = _tenant_id
        AND de.driver_id = _emp.driver_id
        AND COALESCE(de.reimbursable, false) = true
        AND de.status = 'approved'
        AND COALESCE(de.paid_with_advance, false) = false
        AND COALESCE(de.expense_date, de.created_at::date) BETWEEN _period_start AND _period_end
      ON CONFLICT DO NOTHING;
    END IF;

    PERFORM public.recompute_payroll_entry_totals(_entry_id);
    UPDATE public.payroll_entries SET status = 'calculated' WHERE id = _entry_id AND status = 'draft';
  END LOOP;

  UPDATE public.payroll_periods SET status = 'calculated', updated_at = now()
    WHERE id = _period_id AND status = 'draft';

  RETURN _period_id;
END;
$$;

-- =====================================================
-- RPC: recalculate_payroll_entry
-- =====================================================
CREATE OR REPLACE FUNCTION public.recalculate_payroll_entry(_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
  _period uuid;
  _pstatus text;
BEGIN
  SELECT e.tenant_id, e.payroll_period_id, p.status
    INTO _tenant, _period, _pstatus
  FROM public.payroll_entries e
  JOIN public.payroll_periods p ON p.id = e.payroll_period_id
  WHERE e.id = _entry_id;

  IF _tenant IS NULL THEN RAISE EXCEPTION 'entry not found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(_tenant) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _pstatus IN ('approved','closed','cancelled') THEN
    RAISE EXCEPTION 'período bloqueado (%)', _pstatus;
  END IF;

  PERFORM public.recompute_payroll_entry_totals(_entry_id);
END;
$$;

-- =====================================================
-- RPC: approve_payroll_period
-- =====================================================
CREATE OR REPLACE FUNCTION public.approve_payroll_period(_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
  _pstart date;
  _pend date;
  _entry record;
  _existing uuid;
  _user uuid := auth.uid();
BEGIN
  SELECT tenant_id, period_start, period_end INTO _tenant, _pstart, _pend
    FROM public.payroll_periods WHERE id = _period_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'período não encontrado'; END IF;
  IF NOT public.is_tenant_operator_or_admin(_tenant) THEN RAISE EXCEPTION 'not authorized'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payroll_entries WHERE payroll_period_id = _period_id) THEN
    RAISE EXCEPTION 'período sem entradas';
  END IF;

  -- Recompute totals & lock items
  FOR _entry IN SELECT id FROM public.payroll_entries WHERE payroll_period_id = _period_id LOOP
    PERFORM public.recompute_payroll_entry_totals(_entry.id);
  END LOOP;
  UPDATE public.payroll_entry_items SET locked = true WHERE payroll_period_id = _period_id;
  UPDATE public.payroll_entries SET status = 'approved' WHERE payroll_period_id = _period_id AND status <> 'cancelled';

  -- Generate payables for amount_to_pay > 0
  FOR _entry IN
    SELECT e.id, e.employee_id, e.driver_id, e.amount_to_pay, emp.name AS employee_name
    FROM public.payroll_entries e
    JOIN public.employees emp ON emp.id = e.employee_id
    WHERE e.payroll_period_id = _period_id
      AND e.amount_to_pay > 0
      AND e.status <> 'cancelled'
  LOOP
    -- Deduplicate: skip if payable already exists tagged with this entry
    SELECT id INTO _existing FROM public.payables
      WHERE tenant_id = _tenant
        AND category = 'payroll'
        AND (notes IS NOT NULL AND notes LIKE '%payroll_entry_id=' || _entry.id::text || '%')
      LIMIT 1;
    IF _existing IS NULL THEN
      INSERT INTO public.payables(tenant_id, supplier_name, category, description, amount,
        competence_date, due_date, driver_id, status, created_by, notes)
      VALUES (_tenant, _entry.employee_name, 'payroll',
        'Folha ' || to_char(_pstart,'DD/MM/YYYY') || '–' || to_char(_pend,'DD/MM/YYYY') || ' — ' || _entry.employee_name,
        _entry.amount_to_pay, _pstart, _pend, _entry.driver_id, 'pending', _user,
        'payroll_period_id=' || _period_id::text || '; payroll_entry_id=' || _entry.id::text || '; employee_id=' || _entry.employee_id::text);
    END IF;
  END LOOP;

  UPDATE public.payroll_periods
     SET status = 'approved', approved_by = _user, approved_at = now(), updated_at = now()
   WHERE id = _period_id;
END;
$$;

-- =====================================================
-- RPC: close_payroll_period
-- =====================================================
CREATE OR REPLACE FUNCTION public.close_payroll_period(_period_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
  _open_balance numeric(14,2);
  _user uuid := auth.uid();
BEGIN
  SELECT tenant_id INTO _tenant FROM public.payroll_periods WHERE id = _period_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'período não encontrado'; END IF;
  IF NOT public.is_tenant_admin(_tenant) THEN RAISE EXCEPTION 'somente admin/owner pode fechar folha'; END IF;

  SELECT COALESCE(SUM(amount_to_pay),0) INTO _open_balance
    FROM public.payroll_entries WHERE payroll_period_id = _period_id AND payment_status <> 'paid';
  IF _open_balance > 0 AND (_reason IS NULL OR length(trim(_reason)) = 0) THEN
    RAISE EXCEPTION 'saldo em aberto (%), motivo obrigatório', _open_balance;
  END IF;

  UPDATE public.payroll_periods
     SET status = 'closed', closed_by = _user, closed_at = now(),
         notes = COALESCE(notes,'') || CASE WHEN _reason IS NOT NULL THEN E'\n[Fechamento] '||_reason ELSE '' END,
         updated_at = now()
   WHERE id = _period_id;
END;
$$;

-- =====================================================
-- RPC: register_employee_advance
-- =====================================================
CREATE OR REPLACE FUNCTION public.register_employee_advance(
  _tenant_id uuid,
  _employee_id uuid,
  _amount numeric,
  _advance_date date DEFAULT current_date,
  _reason text DEFAULT NULL,
  _payment_method text DEFAULT NULL,
  _payment_reference text DEFAULT NULL,
  _create_payable boolean DEFAULT false,
  _mark_paid boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _advance_id uuid;
  _driver uuid;
  _employee_name text;
  _payable_id uuid;
  _user uuid := auth.uid();
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'valor deve ser positivo'; END IF;

  SELECT driver_id, name INTO _driver, _employee_name
    FROM public.employees WHERE id = _employee_id AND tenant_id = _tenant_id;
  IF _employee_name IS NULL THEN RAISE EXCEPTION 'funcionário não encontrado'; END IF;

  INSERT INTO public.employee_advances(tenant_id, employee_id, driver_id, amount,
    advance_date, reason, payment_method, payment_reference,
    status, approved_by, approved_at, paid_by, paid_at, created_by)
  VALUES (_tenant_id, _employee_id, _driver, _amount,
    _advance_date, _reason, _payment_method, _payment_reference,
    CASE WHEN _mark_paid THEN 'paid' WHEN _create_payable THEN 'approved' ELSE 'pending' END,
    CASE WHEN _create_payable OR _mark_paid THEN _user END,
    CASE WHEN _create_payable OR _mark_paid THEN now() END,
    CASE WHEN _mark_paid THEN _user END,
    CASE WHEN _mark_paid THEN now() END,
    _user)
  RETURNING id INTO _advance_id;

  IF _create_payable THEN
    INSERT INTO public.payables(tenant_id, supplier_name, category, description, amount,
      competence_date, due_date, driver_id, status, created_by, notes)
    VALUES (_tenant_id, _employee_name,
      CASE WHEN _driver IS NOT NULL THEN 'driver_advance' ELSE 'payroll' END,
      'Adiantamento — ' || _employee_name || COALESCE(' — '||_reason,''),
      _amount, _advance_date, _advance_date, _driver,
      CASE WHEN _mark_paid THEN 'paid' ELSE 'pending' END,
      _user,
      'employee_advance_id=' || _advance_id::text)
    RETURNING id INTO _payable_id;
    UPDATE public.employee_advances SET payable_id = _payable_id WHERE id = _advance_id;
  END IF;

  RETURN _advance_id;
END;
$$;
