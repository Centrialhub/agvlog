
-- 1. Create Operational Ledger for immutable audit
CREATE TABLE IF NOT EXISTS public.operational_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id),
    source_table text NOT NULL,
    source_id uuid NOT NULL,
    entry_type text NOT NULL, -- 'revenue', 'expense', 'advance', 'settlement_credit', 'settlement_debit'
    nature text NOT NULL CHECK (nature IN ('credit', 'debit')),
    amount numeric NOT NULL,
    status text NOT NULL DEFAULT 'active', -- 'active', 'reversed', 'voided'
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key text,
    created_by uuid REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, idempotency_key)
);

GRANT SELECT, INSERT, UPDATE ON public.operational_ledger TO authenticated;
GRANT ALL ON public.operational_ledger TO service_role;

ALTER TABLE public.operational_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON public.operational_ledger
    FOR ALL TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- 2. Add idempotency and audit to financial_obligations
ALTER TABLE public.financial_obligations 
ADD COLUMN IF NOT EXISTS idempotency_key text,
ADD COLUMN IF NOT EXISTS ledger_entry_id uuid REFERENCES public.operational_ledger(id),
ADD COLUMN IF NOT EXISTS auditor_id uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS audited_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_obligations_idempotency 
ON public.financial_obligations (tenant_id, idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- 3. Trigger to keep updated_at fresh
CREATE OR REPLACE TRIGGER trg_operational_ledger_updated_at
    BEFORE UPDATE ON public.operational_ledger
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. RPC to approve an obligation (Operational Financial Approval)
CREATE OR REPLACE FUNCTION public.approve_financial_obligation_v1(
    _obligation_id uuid,
    _notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id uuid;
    v_user_id uuid := auth.uid();
BEGIN
    SELECT tenant_id INTO v_tenant_id FROM public.financial_obligations WHERE id = _obligation_id;
    
    IF NOT public.is_tenant_operator_or_admin(v_tenant_id) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    UPDATE public.financial_obligations
    SET 
        status = 'approved',
        auditor_id = v_user_id,
        audited_at = now(),
        metadata = metadata || jsonb_build_object('approval_notes', _notes),
        updated_at = now()
    WHERE id = _obligation_id
      AND status = 'pending';

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_financial_obligation_v1(uuid, text) TO authenticated;

-- 5. RPC to reverse an obligation
CREATE OR REPLACE FUNCTION public.reverse_financial_obligation_v1(
    _obligation_id uuid,
    _reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id uuid;
    v_user_id uuid := auth.uid();
BEGIN
    SELECT tenant_id INTO v_tenant_id FROM public.financial_obligations WHERE id = _obligation_id;
    
    IF NOT public.is_tenant_operator_or_admin(v_tenant_id) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    -- Only pending or approved can be reversed (paid ones need refund flow)
    UPDATE public.financial_obligations
    SET 
        status = 'cancelled',
        metadata = metadata || jsonb_build_object('reversal_reason', _reason, 'reversed_by', v_user_id, 'reversed_at', now()),
        updated_at = now()
    WHERE id = _obligation_id
      AND status IN ('pending', 'approved');

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reverse_financial_obligation_v1(uuid, text) TO authenticated;
