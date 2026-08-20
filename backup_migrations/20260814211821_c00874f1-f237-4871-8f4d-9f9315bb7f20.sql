CREATE OR REPLACE FUNCTION public.release_inbound_notes_from_failed_cte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_sefaz_status text;
  v_outbound_id uuid;
BEGIN
  v_outbound_id := COALESCE(NEW.id, OLD.id);
  v_status := lower(trim(COALESCE(NEW.status, OLD.status, '')));
  v_sefaz_status := lower(trim(COALESCE(NEW.sefaz_status, OLD.sefaz_status, '')));

  IF COALESCE(NEW.document_type, OLD.document_type) = 'outbound'
     AND (
       v_status IN ('rejected', 'rejeitada', 'rejeitado', 'error', 'erro', 'failed', 'denied', 'denegada', 'denegado')
       OR v_sefaz_status IN ('rejected', 'rejeitada', 'rejeitado', 'error', 'erro', 'failed', 'processed_error', 'sent_error', 'sefaz_error', 'denied', 'denegada', 'denegado')
     ) THEN
    UPDATE public.fiscal_documents
       SET cte_emitted_at = NULL,
           cte_emitted_outbound_id = NULL
     WHERE cte_emitted_outbound_id = v_outbound_id
       AND document_type = 'inbound';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_release_notes_from_failed_cte ON public.fiscal_documents;
CREATE TRIGGER trg_release_notes_from_failed_cte
AFTER INSERT OR UPDATE OF status, sefaz_status OR DELETE
ON public.fiscal_documents
FOR EACH ROW
EXECUTE FUNCTION public.release_inbound_notes_from_failed_cte();

-- Corrige qualquer vínculo residual já existente em tentativa rejeitada/com erro.
UPDATE public.fiscal_documents AS src
SET cte_emitted_at = NULL,
    cte_emitted_outbound_id = NULL
FROM public.fiscal_documents AS outbound
WHERE src.cte_emitted_outbound_id = outbound.id
  AND src.document_type = 'inbound'
  AND outbound.document_type = 'outbound'
  AND (
    lower(trim(COALESCE(outbound.status, ''))) IN ('rejected', 'rejeitada', 'rejeitado', 'error', 'erro', 'failed', 'denied', 'denegada', 'denegado')
    OR lower(trim(COALESCE(outbound.sefaz_status, ''))) IN ('rejected', 'rejeitada', 'rejeitado', 'error', 'erro', 'failed', 'processed_error', 'sent_error', 'sefaz_error', 'denied', 'denegada', 'denegado')
  );
-- linter:allow-no-tenant legacy-migration 2026-12-31
