
CREATE OR REPLACE FUNCTION public.create_ledger_entry_v1(
    _tenant_id uuid,
    _source_table text,
    _source_id uuid,
    _entry_type text,
    _nature text,
    _amount numeric,
    _description text,
    _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO public.operational_ledger (
        tenant_id, source_table, source_id, entry_type, nature, amount, status, metadata
    )
    VALUES (
        _tenant_id, _source_table, _source_id, _entry_type, _nature::public.ledger_nature, _amount, 'active', 
        _metadata || jsonb_build_object('description', _description)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_ledger_entry_v1(uuid, text, uuid, text, text, numeric, text, jsonb) TO authenticated;

-- Overwrite approve_financial_obligation_v1 to include ledger entry
CREATE OR REPLACE FUNCTION public.approve_financial_obligation_v1(_obligation_id uuid, _notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
  SET search_path = public
 SET search_path TO 'public'
AS $function$
DECLARE
    v_rec public.financial_obligations;
    v_ledger_id uuid;
    v_user_id uuid := auth.uid();
BEGIN
    SELECT * INTO v_rec FROM public.financial_obligations WHERE id = _obligation_id;
    
    IF NOT public.is_tenant_operator_or_admin(v_rec.tenant_id) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    IF v_rec.status != 'pending' THEN
        RETURN FALSE;
    END IF;

    -- Update obligation
    UPDATE public.financial_obligations
    SET 
        status = 'approved',
        auditor_id = v_user_id,
        audited_at = now(),
        metadata = metadata || jsonb_build_object('approval_notes', _notes),
        updated_at = now()
    WHERE id = _obligation_id;

    -- Create Ledger Entry
    -- Credit for Inflow (Receivables), Debit for Outflow (Payables/Settlements)
    v_ledger_id := public.create_ledger_entry_v1(
        v_rec.tenant_id,
        'financial_obligations',
        v_rec.id,
        v_rec.obligation_type,
        CASE WHEN v_rec.direction = 'inflow' THEN 'credit' ELSE 'debit' END,
        v_rec.amount_expected,
        COALESCE(_notes, v_rec.description),
        jsonb_build_object('obligation_id', v_rec.id, 'direction', v_rec.direction)
    );

    UPDATE public.financial_obligations SET ledger_entry_id = v_ledger_id WHERE id = _obligation_id;

    RETURN TRUE;
END;
$function$;
