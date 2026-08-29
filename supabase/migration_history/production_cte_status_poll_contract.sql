-- Aligns fiscal_documents with the deployed cte-status-poll Edge Function.

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS last_status_check_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS status_check_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_status_response jsonb;

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_pending_cte_status
  ON public.fiscal_documents USING btree (status, last_status_check_at)
  WHERE hub_document_id IS NOT NULL;

DO $cte_status_poll_contract_postconditions$
DECLARE
  missing_columns integer;
BEGIN
  SELECT count(*) INTO missing_columns
  FROM unnest(ARRAY[
    'last_status_check_at',
    'status_check_attempts',
    'last_status_response'
  ]) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'fiscal_documents'
      AND information_schema.columns.column_name = required.column_name
  );

  IF missing_columns > 0 THEN
    RAISE EXCEPTION 'Postcondition failed: % CT-e status column(s) are missing', missing_columns;
  END IF;

  IF to_regclass('public.idx_fiscal_documents_pending_cte_status') IS NULL THEN
    RAISE EXCEPTION 'Postcondition failed: CT-e status polling index is missing';
  END IF;
END;
$cte_status_poll_contract_postconditions$;
