
-- ============================================================
-- PR1: Conciliação Bancária - Fundação
-- ============================================================

-- Reuse existing updated_at trigger (already defined in earlier migrations as public.update_updated_at_column())

-- ------------------------------------------------------------
-- bank_accounts
-- ------------------------------------------------------------
CREATE TABLE public.bank_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bank_name TEXT,
  bank_code TEXT,
  branch_number TEXT,
  account_number TEXT,
  account_type TEXT NOT NULL DEFAULT 'checking'
    CHECK (account_type IN ('checking','savings','cash','company_card','pix','other')),
  pix_key TEXT,
  initial_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO authenticated;
GRANT ALL ON public.bank_accounts TO service_role;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_accounts_select" ON public.bank_accounts
  FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "bank_accounts_manage" ON public.bank_accounts
  FOR ALL TO authenticated
  USING (is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (is_tenant_operator_or_admin(tenant_id));
CREATE INDEX idx_bank_accounts_tenant ON public.bank_accounts(tenant_id) WHERE active;
CREATE TRIGGER trg_bank_accounts_updated_at
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- bank_statement_imports
-- ------------------------------------------------------------
CREATE TABLE public.bank_statement_imports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  file_name TEXT,
  file_hash TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  imported_by UUID,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'imported'
    CHECK (status IN ('draft','imported','reconciled','closed','cancelled')),
  rows_count INTEGER NOT NULL DEFAULT 0,
  total_inflow NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_outflow NUMERIC(14,2) NOT NULL DEFAULT 0,
  raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_bank_statement_imports_dedupe
  ON public.bank_statement_imports(tenant_id, bank_account_id, file_hash);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_statement_imports TO authenticated;
GRANT ALL ON public.bank_statement_imports TO service_role;
ALTER TABLE public.bank_statement_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_statement_imports_select" ON public.bank_statement_imports
  FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "bank_statement_imports_manage" ON public.bank_statement_imports
  FOR ALL TO authenticated
  USING (is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (is_tenant_operator_or_admin(tenant_id));
CREATE TRIGGER trg_bank_statement_imports_updated_at
  BEFORE UPDATE ON public.bank_statement_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- bank_transactions
-- ------------------------------------------------------------
CREATE TABLE public.bank_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  import_id UUID REFERENCES public.bank_statement_imports(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ NOT NULL,
  description TEXT,
  normalized_description TEXT,
  amount NUMERIC(14,2) NOT NULL,
  transaction_type TEXT NOT NULL DEFAULT 'debit'
    CHECK (transaction_type IN ('credit','debit')),
  external_id TEXT,
  document_number TEXT,
  counterparty_name TEXT,
  balance_after NUMERIC(14,2),
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_key TEXT,
  reconciliation_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (reconciliation_status IN ('unmatched','suggested','matched','ignored','manual_review')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_transactions TO authenticated;
GRANT ALL ON public.bank_transactions TO service_role;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_transactions_select" ON public.bank_transactions
  FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "bank_transactions_manage" ON public.bank_transactions
  FOR ALL TO authenticated
  USING (is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (is_tenant_operator_or_admin(tenant_id));
CREATE INDEX idx_bank_transactions_tenant_account_date
  ON public.bank_transactions(tenant_id, bank_account_id, posted_at DESC);
CREATE INDEX idx_bank_transactions_status
  ON public.bank_transactions(tenant_id, reconciliation_status);
CREATE INDEX idx_bank_transactions_amount
  ON public.bank_transactions(tenant_id, bank_account_id, amount);
CREATE UNIQUE INDEX uq_bank_transactions_normkey
  ON public.bank_transactions(tenant_id, bank_account_id, normalized_key)
  WHERE normalized_key IS NOT NULL;
CREATE TRIGGER trg_bank_transactions_updated_at
  BEFORE UPDATE ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- financial_obligations
-- ------------------------------------------------------------
CREATE TABLE public.financial_obligations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inflow','outflow')),
  obligation_type TEXT NOT NULL
    CHECK (obligation_type IN ('receivable','payable','driver_settlement_payment','driver_expense','maintenance','fuel','manual_adjustment','other')),
  source_table TEXT,
  source_id UUID,
  description TEXT,
  counterparty_type TEXT CHECK (counterparty_type IN ('client','supplier','driver','employee','bank','other')),
  counterparty_id UUID,
  counterparty_name TEXT,
  amount_expected NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_matched NUMERIC(14,2) NOT NULL DEFAULT 0,
  open_balance NUMERIC(14,2) GENERATED ALWAYS AS (amount_expected - amount_matched) STORED,
  due_date DATE,
  expected_payment_date DATE,
  competence_date DATE,
  payment_method_expected TEXT,
  bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','partially_paid','paid','cancelled','written_off')),
  matching_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (matching_status IN ('unmatched','suggested','matched','partial','ignored')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_obligations TO authenticated;
GRANT ALL ON public.financial_obligations TO service_role;
ALTER TABLE public.financial_obligations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "financial_obligations_select" ON public.financial_obligations
  FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "financial_obligations_manage" ON public.financial_obligations
  FOR ALL TO authenticated
  USING (is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (is_tenant_operator_or_admin(tenant_id));
CREATE UNIQUE INDEX uq_financial_obligations_source
  ON public.financial_obligations(tenant_id, source_table, source_id, obligation_type)
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL;
CREATE INDEX idx_financial_obligations_status
  ON public.financial_obligations(tenant_id, status, direction, due_date);
CREATE INDEX idx_financial_obligations_matching
  ON public.financial_obligations(tenant_id, matching_status);
CREATE INDEX idx_financial_obligations_counterparty
  ON public.financial_obligations(tenant_id, counterparty_type, counterparty_id);
CREATE TRIGGER trg_financial_obligations_updated_at
  BEFORE UPDATE ON public.financial_obligations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- payables
-- ------------------------------------------------------------
CREATE TABLE public.payables (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL,
  supplier_id UUID,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('supplier','fuel','toll','maintenance','tax','payroll','driver_advance','rent','insurance','service','other')),
  description TEXT,
  amount NUMERIC(14,2) NOT NULL,
  due_date DATE,
  competence_date DATE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','paid','overdue','cancelled')),
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  dispatch_trip_id UUID REFERENCES public.dispatch_trips(id) ON DELETE SET NULL,
  load_id UUID REFERENCES public.loads(id) ON DELETE SET NULL,
  document_number TEXT,
  receipt_url TEXT,
  notes TEXT,
  created_by UUID,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payables TO authenticated;
GRANT ALL ON public.payables TO service_role;
ALTER TABLE public.payables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payables_select" ON public.payables
  FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "payables_manage" ON public.payables
  FOR ALL TO authenticated
  USING (is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (is_tenant_operator_or_admin(tenant_id));
CREATE INDEX idx_payables_status ON public.payables(tenant_id, status, due_date);
CREATE INDEX idx_payables_supplier ON public.payables(tenant_id, supplier_id);
CREATE TRIGGER trg_payables_updated_at
  BEFORE UPDATE ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- financial_matches
-- ------------------------------------------------------------
CREATE TABLE public.financial_matches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bank_transaction_id UUID NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  financial_obligation_id UUID NOT NULL REFERENCES public.financial_obligations(id) ON DELETE CASCADE,
  amount_matched NUMERIC(14,2) NOT NULL,
  confidence_score NUMERIC(5,2),
  match_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (match_type IN ('auto','suggested','manual','split','aggregate')),
  status TEXT NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested','accepted','rejected','reversed')),
  reason TEXT,
  created_by UUID,
  accepted_by UUID,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_matches TO authenticated;
GRANT ALL ON public.financial_matches TO service_role;
ALTER TABLE public.financial_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "financial_matches_select" ON public.financial_matches
  FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "financial_matches_manage" ON public.financial_matches
  FOR ALL TO authenticated
  USING (is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (is_tenant_operator_or_admin(tenant_id));
CREATE INDEX idx_financial_matches_tx ON public.financial_matches(tenant_id, bank_transaction_id);
CREATE INDEX idx_financial_matches_obg ON public.financial_matches(tenant_id, financial_obligation_id);
CREATE INDEX idx_financial_matches_status ON public.financial_matches(tenant_id, status);
CREATE TRIGGER trg_financial_matches_updated_at
  BEFORE UPDATE ON public.financial_matches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- bank_reconciliation_sessions
-- ------------------------------------------------------------
CREATE TABLE public.bank_reconciliation_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_review','closed','reopened','cancelled')),
  total_bank_inflow NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_bank_outflow NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_matched NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_unmatched NUMERIC(14,2) NOT NULL DEFAULT 0,
  closed_by UUID,
  closed_at TIMESTAMPTZ,
  reopened_by UUID,
  reopened_at TIMESTAMPTZ,
  reopen_reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_reconciliation_sessions TO authenticated;
GRANT ALL ON public.bank_reconciliation_sessions TO service_role;
ALTER TABLE public.bank_reconciliation_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_recon_sessions_select" ON public.bank_reconciliation_sessions
  FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY "bank_recon_sessions_manage" ON public.bank_reconciliation_sessions
  FOR ALL TO authenticated
  USING (is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (is_tenant_operator_or_admin(tenant_id));
CREATE INDEX idx_recon_sessions_account_period
  ON public.bank_reconciliation_sessions(tenant_id, bank_account_id, period_start, period_end);
CREATE TRIGGER trg_recon_sessions_updated_at
  BEFORE UPDATE ON public.bank_reconciliation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- bank_reconciliation_audit
-- ------------------------------------------------------------
CREATE TABLE public.bank_reconciliation_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  action TEXT NOT NULL
    CHECK (action IN ('imported_statement','auto_match_run','match_suggested','match_accepted','match_rejected','manual_match_created','match_reversed','transaction_ignored','obligation_written_off','session_closed','session_reopened')),
  entity_table TEXT,
  entity_id UUID,
  session_id UUID REFERENCES public.bank_reconciliation_sessions(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bank_reconciliation_audit TO authenticated;
GRANT ALL ON public.bank_reconciliation_audit TO service_role;
ALTER TABLE public.bank_reconciliation_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_recon_audit_select" ON public.bank_reconciliation_audit
  FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
-- writes only via SECURITY DEFINER RPCs (no insert policy for authenticated)
CREATE INDEX idx_recon_audit_tenant_time
  ON public.bank_reconciliation_audit(tenant_id, created_at DESC);
CREATE INDEX idx_recon_audit_entity
  ON public.bank_reconciliation_audit(tenant_id, entity_table, entity_id);
