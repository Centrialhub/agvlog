
-- ============================================================
-- PR3: matching engine + session lifecycle
-- ============================================================

-- Helper: apply a match delta to obligation + transaction (used internally)
CREATE OR REPLACE FUNCTION public._apply_match_amounts(
  _obligation_id UUID,
  _transaction_id UUID,
  _delta NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_new_matched NUMERIC;
  v_expected NUMERIC;
  v_tx_amount NUMERIC;
  v_tx_used NUMERIC;
BEGIN
  UPDATE public.financial_obligations
     SET amount_matched = amount_matched + _delta,
         updated_at = now()
   WHERE id = _obligation_id
   RETURNING amount_matched, amount_expected INTO v_new_matched, v_expected;

  UPDATE public.financial_obligations
     SET status = CASE
           WHEN status IN ('cancelled','written_off') THEN status
           WHEN v_new_matched <= 0 THEN 'pending'
           WHEN v_new_matched >= v_expected THEN 'paid'
           ELSE 'partially_paid'
         END,
         matching_status = CASE
           WHEN v_new_matched <= 0 THEN 'unmatched'
           WHEN v_new_matched >= v_expected THEN 'matched'
           ELSE 'partial'
         END
   WHERE id = _obligation_id;

  -- Compute how much of the transaction is used by all accepted matches
  SELECT abs(bt.amount),
         COALESCE(SUM(fm.amount_matched) FILTER (WHERE fm.status = 'accepted'), 0)
    INTO v_tx_amount, v_tx_used
    FROM public.bank_transactions bt
    LEFT JOIN public.financial_matches fm ON fm.bank_transaction_id = bt.id
   WHERE bt.id = _transaction_id
   GROUP BY bt.amount;

  UPDATE public.bank_transactions
     SET reconciliation_status = CASE
           WHEN v_tx_used <= 0 THEN 'unmatched'
           WHEN v_tx_used >= v_tx_amount THEN 'matched'
           ELSE 'manual_review'
         END,
         updated_at = now()
   WHERE id = _transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION public._apply_match_amounts(UUID, UUID, NUMERIC) FROM PUBLIC;

-- ------------------------------------------------------------
-- run_bank_reconciliation
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_bank_reconciliation(
  _tenant_id UUID,
  _bank_account_id UUID,
  _period_start DATE,
  _period_end DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_auto INT := 0;
  v_suggested INT := 0;
  v_scanned INT := 0;
  r_tx RECORD;
  r_best RECORD;
  r_second RECORD;
  v_score NUMERIC;
  v_direction TEXT;
  v_abs NUMERIC;
  v_norm_desc TEXT;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR r_tx IN
    SELECT id, amount, posted_at, description, normalized_description,
           counterparty_name, document_number
      FROM public.bank_transactions
     WHERE tenant_id = _tenant_id
       AND bank_account_id = _bank_account_id
       AND posted_at::date BETWEEN _period_start AND _period_end
       AND reconciliation_status IN ('unmatched','suggested')
  LOOP
    v_scanned := v_scanned + 1;
    v_direction := CASE WHEN r_tx.amount >= 0 THEN 'inflow' ELSE 'outflow' END;
    v_abs := abs(r_tx.amount);
    v_norm_desc := lower(coalesce(r_tx.normalized_description, r_tx.description, ''));

    -- Score candidates and pick top 2
    WITH cand AS (
      SELECT o.id,
             o.amount_expected - o.amount_matched AS open_balance,
             o.counterparty_name,
             o.description,
             o.due_date,
             o.metadata,
             (
               -- amount closeness
               CASE
                 WHEN (o.amount_expected - o.amount_matched) = v_abs THEN 50
                 WHEN abs((o.amount_expected - o.amount_matched) - v_abs) <= 0.02 THEN 45
                 WHEN v_abs > 0 AND abs((o.amount_expected - o.amount_matched) - v_abs) / v_abs <= 0.01 THEN 30
                 ELSE 0
               END
               +
               -- date proximity (based on due_date)
               CASE
                 WHEN o.due_date IS NULL THEN 5
                 WHEN abs(EXTRACT(DAY FROM (r_tx.posted_at::date - o.due_date))) <= 3 THEN 20
                 WHEN abs(EXTRACT(DAY FROM (r_tx.posted_at::date - o.due_date))) <= 7 THEN 10
                 ELSE 0
               END
               +
               -- counterparty in description
               CASE
                 WHEN o.counterparty_name IS NOT NULL
                      AND length(o.counterparty_name) >= 4
                      AND position(lower(o.counterparty_name) IN v_norm_desc) > 0 THEN 20
                 ELSE 0
               END
               +
               -- document match
               CASE
                 WHEN r_tx.document_number IS NOT NULL
                      AND (o.metadata->>'document_number' = r_tx.document_number
                           OR o.metadata->>'invoice_number' = r_tx.document_number) THEN 20
                 ELSE 0
               END
             ) AS score
        FROM public.financial_obligations o
       WHERE o.tenant_id = _tenant_id
         AND o.direction = v_direction
         AND o.status NOT IN ('paid','cancelled','written_off')
         AND o.matching_status <> 'matched'
         AND (o.amount_expected - o.amount_matched) > 0
    )
    SELECT * INTO r_best FROM cand ORDER BY score DESC, open_balance ASC LIMIT 1;

    IF r_best IS NULL OR r_best.score < 70 THEN
      CONTINUE;
    END IF;

    SELECT * INTO r_second FROM (
      SELECT * FROM (
        WITH cand AS (
          SELECT o.id,
                 o.amount_expected - o.amount_matched AS open_balance,
                 (
                   CASE
                     WHEN (o.amount_expected - o.amount_matched) = v_abs THEN 50
                     WHEN abs((o.amount_expected - o.amount_matched) - v_abs) <= 0.02 THEN 45
                     WHEN v_abs > 0 AND abs((o.amount_expected - o.amount_matched) - v_abs) / v_abs <= 0.01 THEN 30
                     ELSE 0
                   END
                   +
                   CASE
                     WHEN o.due_date IS NULL THEN 5
                     WHEN abs(EXTRACT(DAY FROM (r_tx.posted_at::date - o.due_date))) <= 3 THEN 20
                     WHEN abs(EXTRACT(DAY FROM (r_tx.posted_at::date - o.due_date))) <= 7 THEN 10
                     ELSE 0
                   END
                   +
                   CASE
                     WHEN o.counterparty_name IS NOT NULL
                          AND length(o.counterparty_name) >= 4
                          AND position(lower(o.counterparty_name) IN v_norm_desc) > 0 THEN 20
                     ELSE 0
                   END
                   +
                   CASE
                     WHEN r_tx.document_number IS NOT NULL
                          AND (o.metadata->>'document_number' = r_tx.document_number
                               OR o.metadata->>'invoice_number' = r_tx.document_number) THEN 20
                     ELSE 0
                   END
                 ) AS score
            FROM public.financial_obligations o
           WHERE o.tenant_id = _tenant_id
             AND o.direction = v_direction
             AND o.status NOT IN ('paid','cancelled','written_off')
             AND o.matching_status <> 'matched'
             AND (o.amount_expected - o.amount_matched) > 0
             AND o.id <> r_best.id
        )
        SELECT id, score FROM cand ORDER BY score DESC LIMIT 1
      ) x
    ) AS y;

    v_score := LEAST(r_best.score, 100);

    -- Decide auto vs suggested
    IF v_score >= 90 AND (r_second IS NULL OR r_second.score < 80) THEN
      -- auto-accept 1:1 for the amount that fits
      INSERT INTO public.financial_matches (
        tenant_id, bank_transaction_id, financial_obligation_id,
        amount_matched, confidence_score, match_type, status,
        created_by, accepted_by, accepted_at
      ) VALUES (
        _tenant_id, r_tx.id, r_best.id,
        LEAST(v_abs, r_best.open_balance), v_score, 'auto', 'accepted',
        v_user, v_user, now()
      );
      PERFORM public._apply_match_amounts(r_best.id, r_tx.id, LEAST(v_abs, r_best.open_balance));
      INSERT INTO public.bank_reconciliation_audit (tenant_id, action, entity_table, entity_id, payload, user_id)
      VALUES (_tenant_id, 'match_accepted', 'bank_transactions', r_tx.id,
              jsonb_build_object('obligation_id', r_best.id, 'score', v_score, 'auto', true), v_user);
      v_auto := v_auto + 1;
    ELSE
      -- suggested
      INSERT INTO public.financial_matches (
        tenant_id, bank_transaction_id, financial_obligation_id,
        amount_matched, confidence_score, match_type, status, created_by
      ) VALUES (
        _tenant_id, r_tx.id, r_best.id,
        LEAST(v_abs, r_best.open_balance), v_score, 'suggested', 'suggested',
        v_user
      )
      ON CONFLICT DO NOTHING;
      UPDATE public.bank_transactions SET reconciliation_status = 'suggested' WHERE id = r_tx.id AND reconciliation_status = 'unmatched';
      UPDATE public.financial_obligations SET matching_status = CASE WHEN matching_status='matched' THEN 'matched' ELSE 'suggested' END WHERE id = r_best.id;
      INSERT INTO public.bank_reconciliation_audit (tenant_id, action, entity_table, entity_id, payload, user_id)
      VALUES (_tenant_id, 'match_suggested', 'bank_transactions', r_tx.id,
              jsonb_build_object('obligation_id', r_best.id, 'score', v_score), v_user);
      v_suggested := v_suggested + 1;
    END IF;
  END LOOP;

  INSERT INTO public.bank_reconciliation_audit (tenant_id, action, entity_table, entity_id, payload, user_id)
  VALUES (_tenant_id, 'auto_match_run', 'bank_accounts', _bank_account_id,
          jsonb_build_object('period_start', _period_start, 'period_end', _period_end,
                             'scanned', v_scanned, 'auto', v_auto, 'suggested', v_suggested),
          v_user);

  RETURN jsonb_build_object('scanned', v_scanned, 'auto', v_auto, 'suggested', v_suggested);
END;
$$;
REVOKE ALL ON FUNCTION public.run_bank_reconciliation(UUID, UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_bank_reconciliation(UUID, UUID, DATE, DATE) TO authenticated, service_role;

-- ------------------------------------------------------------
-- accept_financial_match
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_financial_match(_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_m public.financial_matches%ROWTYPE;
  v_user UUID := auth.uid();
BEGIN
  SELECT * INTO v_m FROM public.financial_matches WHERE id = _match_id FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'match_not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_m.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_m.status <> 'suggested' THEN RAISE EXCEPTION 'invalid_status'; END IF;

  UPDATE public.financial_matches
     SET status = 'accepted', accepted_by = v_user, accepted_at = now(), updated_at = now()
   WHERE id = _match_id;

  PERFORM public._apply_match_amounts(v_m.financial_obligation_id, v_m.bank_transaction_id, v_m.amount_matched);

  INSERT INTO public.bank_reconciliation_audit (tenant_id, action, entity_table, entity_id, payload, user_id)
  VALUES (v_m.tenant_id, 'match_accepted', 'financial_matches', _match_id,
          jsonb_build_object('obligation_id', v_m.financial_obligation_id,
                             'transaction_id', v_m.bank_transaction_id,
                             'amount', v_m.amount_matched), v_user);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_financial_match(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_financial_match(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------
-- reject_financial_match
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_financial_match(_match_id UUID, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_m public.financial_matches%ROWTYPE;
  v_user UUID := auth.uid();
  v_still INT;
BEGIN
  SELECT * INTO v_m FROM public.financial_matches WHERE id = _match_id FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'match_not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_m.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_m.status <> 'suggested' THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF _reason IS NULL OR trim(_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  UPDATE public.financial_matches
     SET status = 'rejected', reason = _reason, updated_at = now()
   WHERE id = _match_id;

  -- If no more suggestions/accepted for this tx, mark as unmatched
  SELECT COUNT(*) INTO v_still FROM public.financial_matches
    WHERE bank_transaction_id = v_m.bank_transaction_id AND status IN ('suggested','accepted');
  IF v_still = 0 THEN
    UPDATE public.bank_transactions SET reconciliation_status = 'unmatched', updated_at = now()
     WHERE id = v_m.bank_transaction_id;
  END IF;

  SELECT COUNT(*) INTO v_still FROM public.financial_matches
    WHERE financial_obligation_id = v_m.financial_obligation_id AND status IN ('suggested','accepted');
  IF v_still = 0 THEN
    UPDATE public.financial_obligations
       SET matching_status = CASE
             WHEN amount_matched <= 0 THEN 'unmatched'
             WHEN amount_matched >= amount_expected THEN 'matched'
             ELSE 'partial'
           END
     WHERE id = v_m.financial_obligation_id;
  END IF;

  INSERT INTO public.bank_reconciliation_audit (tenant_id, action, entity_table, entity_id, payload, reason, user_id)
  VALUES (v_m.tenant_id, 'match_rejected', 'financial_matches', _match_id,
          jsonb_build_object('obligation_id', v_m.financial_obligation_id,
                             'transaction_id', v_m.bank_transaction_id), _reason, v_user);
END;
$$;
REVOKE ALL ON FUNCTION public.reject_financial_match(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_financial_match(UUID, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------
-- create_manual_financial_match (supports 1:1, 1:N, N:1, partial)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_manual_financial_match(
  _tenant_id UUID,
  _bank_transaction_id UUID,
  _financial_obligation_id UUID,
  _amount_matched NUMERIC,
  _reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_tx public.bank_transactions%ROWTYPE;
  v_ob public.financial_obligations%ROWTYPE;
  v_tx_used NUMERIC;
  v_tx_avail NUMERIC;
  v_ob_avail NUMERIC;
  v_user UUID := auth.uid();
  v_new_id UUID;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _amount_matched IS NULL OR _amount_matched <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  SELECT * INTO v_tx FROM public.bank_transactions
   WHERE id = _bank_transaction_id AND tenant_id = _tenant_id FOR UPDATE;
  IF v_tx.id IS NULL THEN RAISE EXCEPTION 'transaction_not_found'; END IF;

  SELECT * INTO v_ob FROM public.financial_obligations
   WHERE id = _financial_obligation_id AND tenant_id = _tenant_id FOR UPDATE;
  IF v_ob.id IS NULL THEN RAISE EXCEPTION 'obligation_not_found'; END IF;

  -- Direction must match
  IF (v_tx.amount >= 0 AND v_ob.direction <> 'inflow')
     OR (v_tx.amount < 0 AND v_ob.direction <> 'outflow') THEN
    RAISE EXCEPTION 'direction_mismatch';
  END IF;

  SELECT COALESCE(SUM(amount_matched),0) INTO v_tx_used
    FROM public.financial_matches
   WHERE bank_transaction_id = _bank_transaction_id AND status = 'accepted';
  v_tx_avail := abs(v_tx.amount) - v_tx_used;
  v_ob_avail := v_ob.amount_expected - v_ob.amount_matched;

  IF _amount_matched > v_tx_avail + 0.001 THEN RAISE EXCEPTION 'exceeds_transaction_balance'; END IF;
  IF _amount_matched > v_ob_avail + 0.001 THEN RAISE EXCEPTION 'exceeds_obligation_balance'; END IF;

  INSERT INTO public.financial_matches (
    tenant_id, bank_transaction_id, financial_obligation_id,
    amount_matched, confidence_score, match_type, status,
    reason, created_by, accepted_by, accepted_at
  ) VALUES (
    _tenant_id, _bank_transaction_id, _financial_obligation_id,
    _amount_matched, NULL, 'manual', 'accepted',
    _reason, v_user, v_user, now()
  ) RETURNING id INTO v_new_id;

  PERFORM public._apply_match_amounts(_financial_obligation_id, _bank_transaction_id, _amount_matched);

  INSERT INTO public.bank_reconciliation_audit (tenant_id, action, entity_table, entity_id, payload, reason, user_id)
  VALUES (_tenant_id, 'manual_match_created', 'financial_matches', v_new_id,
          jsonb_build_object('obligation_id', _financial_obligation_id,
                             'transaction_id', _bank_transaction_id,
                             'amount', _amount_matched), _reason, v_user);

  RETURN v_new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_manual_financial_match(UUID, UUID, UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_manual_financial_match(UUID, UUID, UUID, NUMERIC, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------
-- reverse_financial_match
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_financial_match(_match_id UUID, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_m public.financial_matches%ROWTYPE;
  v_user UUID := auth.uid();
BEGIN
  SELECT * INTO v_m FROM public.financial_matches WHERE id = _match_id FOR UPDATE;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'match_not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_m.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_m.status <> 'accepted' THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF _reason IS NULL OR trim(_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  UPDATE public.financial_matches
     SET status = 'reversed', reason = COALESCE(reason,'') || ' | reverse: ' || _reason, updated_at = now()
   WHERE id = _match_id;

  PERFORM public._apply_match_amounts(v_m.financial_obligation_id, v_m.bank_transaction_id, - v_m.amount_matched);

  INSERT INTO public.bank_reconciliation_audit (tenant_id, action, entity_table, entity_id, payload, reason, user_id)
  VALUES (v_m.tenant_id, 'match_reversed', 'financial_matches', _match_id,
          jsonb_build_object('obligation_id', v_m.financial_obligation_id,
                             'transaction_id', v_m.bank_transaction_id,
                             'amount', v_m.amount_matched), _reason, v_user);
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_financial_match(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_financial_match(UUID, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------
-- close / reopen session (admin only)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_reconciliation_session(_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_s public.bank_reconciliation_sessions%ROWTYPE;
  v_user UUID := auth.uid();
  v_in NUMERIC; v_out NUMERIC; v_matched NUMERIC;
BEGIN
  SELECT * INTO v_s FROM public.bank_reconciliation_sessions WHERE id = _session_id FOR UPDATE;
  IF v_s.id IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF NOT public.is_tenant_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF v_s.status = 'closed' THEN RAISE EXCEPTION 'already_closed'; END IF;

  SELECT
    COALESCE(SUM(CASE WHEN bt.amount > 0 THEN bt.amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN bt.amount < 0 THEN -bt.amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN bt.reconciliation_status = 'matched' THEN abs(bt.amount) ELSE 0 END),0)
  INTO v_in, v_out, v_matched
  FROM public.bank_transactions bt
  WHERE bt.tenant_id = v_s.tenant_id
    AND bt.bank_account_id = v_s.bank_account_id
    AND bt.posted_at::date BETWEEN v_s.period_start AND v_s.period_end;

  UPDATE public.bank_reconciliation_sessions
     SET status = 'closed',
         total_bank_inflow = v_in,
         total_bank_outflow = v_out,
         total_matched = v_matched,
         total_unmatched = (v_in + v_out) - v_matched,
         closed_by = v_user,
         closed_at = now(),
         updated_at = now()
   WHERE id = _session_id;

  INSERT INTO public.bank_reconciliation_audit (tenant_id, action, entity_table, entity_id, session_id, payload, user_id)
  VALUES (v_s.tenant_id, 'session_closed', 'bank_reconciliation_sessions', _session_id, _session_id,
          jsonb_build_object('total_inflow', v_in, 'total_outflow', v_out, 'total_matched', v_matched), v_user);
END;
$$;
REVOKE ALL ON FUNCTION public.close_reconciliation_session(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_reconciliation_session(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reopen_reconciliation_session(_session_id UUID, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_s public.bank_reconciliation_sessions%ROWTYPE;
  v_user UUID := auth.uid();
BEGIN
  SELECT * INTO v_s FROM public.bank_reconciliation_sessions WHERE id = _session_id FOR UPDATE;
  IF v_s.id IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF NOT public.is_tenant_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF v_s.status <> 'closed' THEN RAISE EXCEPTION 'not_closed'; END IF;
  IF _reason IS NULL OR trim(_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  UPDATE public.bank_reconciliation_sessions
     SET status = 'reopened',
         reopened_by = v_user,
         reopened_at = now(),
         reopen_reason = _reason,
         updated_at = now()
   WHERE id = _session_id;

  INSERT INTO public.bank_reconciliation_audit (tenant_id, action, entity_table, entity_id, session_id, payload, reason, user_id)
  VALUES (v_s.tenant_id, 'session_reopened', 'bank_reconciliation_sessions', _session_id, _session_id,
          jsonb_build_object('previous_closed_at', v_s.closed_at), _reason, v_user);
END;
$$;
REVOKE ALL ON FUNCTION public.reopen_reconciliation_session(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_reconciliation_session(UUID, TEXT) TO authenticated, service_role;
