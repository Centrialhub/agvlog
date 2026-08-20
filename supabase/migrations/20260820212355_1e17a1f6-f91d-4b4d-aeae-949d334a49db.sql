
-- RPC to get centralized financial summary from ledger and canonical sources
CREATE OR REPLACE FUNCTION public.get_operational_financial_summary_v1(
    _tenant_id uuid,
    _date_from date DEFAULT NULL,
    _date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_revenue numeric := 0;
    v_outflow numeric := 0;
    v_ledger_balance numeric := 0;
    v_receivable_total numeric := 0;
    v_receivable_pending numeric := 0;
    v_receivable_paid numeric := 0;
    v_receivable_overdue numeric := 0;
    v_expenses_total numeric := 0;
    v_maintenance_total numeric := 0;
    v_today date := current_date;
BEGIN
    IF NOT public.is_tenant_member(_tenant_id) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    -- 1. Ledger Balance (The Truth)
    SELECT COALESCE(SUM(CASE WHEN nature = 'credit' THEN amount ELSE -amount END), 0)
    INTO v_ledger_balance
    FROM public.operational_ledger
    WHERE tenant_id = _tenant_id
      AND status = 'active'
      AND (_date_from IS NULL OR created_at::date >= _date_from)
      AND (_date_to IS NULL OR created_at::date <= _date_to);

    -- 2. Revenue (CT-e confirmed + NFSe confirmed)
    SELECT COALESCE(SUM(freight_value), 0) INTO v_revenue
    FROM public.fiscal_documents
    WHERE tenant_id = _tenant_id
      AND document_type = 'outbound'
      AND status IN ('authorized', 'registered')
      AND (_date_from IS NULL OR issue_date >= _date_from)
      AND (_date_to IS NULL OR issue_date <= _date_to);

    SELECT v_revenue + COALESCE(SUM(valor_servicos), 0) INTO v_revenue
    FROM public.nfse_documents
    WHERE tenant_id = _tenant_id
      AND status IN ('authorized', 'registered')
      AND (_date_from IS NULL OR issue_date >= _date_from)
      AND (_date_to IS NULL OR issue_date <= _date_to);

    -- 3. Receivables
    SELECT 
        COALESCE(SUM(amount), 0),
        COALESCE(SUM(CASE WHEN status IN ('pending', 'invoiced', 'partial') THEN amount ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN status = 'received' THEN COALESCE(received_amount, amount) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN status IN ('pending', 'invoiced', 'partial') AND due_date < v_today THEN amount ELSE 0 END), 0)
    INTO 
        v_receivable_total, v_receivable_pending, v_receivable_paid, v_receivable_overdue
    FROM public.receivables
    WHERE tenant_id = _tenant_id
      AND status != 'cancelled'
      AND (_date_from IS NULL OR due_date >= _date_from)
      AND (_date_to IS NULL OR due_date <= _date_to);

    -- 4. Expenses
    SELECT COALESCE(SUM(amount), 0) INTO v_expenses_total
    FROM public.driver_expenses
    WHERE tenant_id = _tenant_id
      AND approval_status = 'approved'
      AND (_date_from IS NULL OR expense_at::date >= _date_from)
      AND (_date_to IS NULL OR expense_at::date <= _date_to);

    -- 5. Maintenance
    SELECT COALESCE(SUM(total_cost), 0) INTO v_maintenance_total
    FROM public.maintenance_orders
    WHERE tenant_id = _tenant_id
      AND status IN ('completed', 'closed')
      AND (_date_from IS NULL OR created_at::date >= _date_from)
      AND (_date_to IS NULL OR created_at::date <= _date_to);

    v_outflow := v_expenses_total + v_maintenance_total;

    RETURN jsonb_build_object(
        'revenue', v_revenue,
        'outflow', v_outflow,
        'balance', v_revenue - v_outflow,
        'totalReceivable', v_receivable_total,
        'pendingReceivable', v_receivable_pending,
        'paidReceivable', v_receivable_paid,
        'overdueReceivable', v_receivable_overdue,
        'totalExpenses', v_expenses_total,
        'totalMaintenance', v_maintenance_total,
        'ledgerBalance', v_ledger_balance
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_operational_financial_summary_v1(uuid, date, date) TO authenticated;
