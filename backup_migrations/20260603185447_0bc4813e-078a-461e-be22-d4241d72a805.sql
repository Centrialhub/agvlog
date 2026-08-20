
-- Função para detectar forma de pagamento a partir de texto livre (observação NF, infCpl)
CREATE OR REPLACE FUNCTION public.detect_payment_method(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  t text;
BEGIN
  IF p_text IS NULL OR length(trim(p_text)) = 0 THEN
    RETURN NULL;
  END IF;
  t := ' ' || upper(p_text) || ' ';
  -- ordem: específico -> genérico
  IF t ~ '\mPIX\M' THEN RETURN 'pix'; END IF;
  IF t ~ '\m(BOLETO|COBRAN[ÇC]A\s*BANC[ÁA]RIA|DUPLICATA)\M' THEN RETURN 'boleto'; END IF;
  IF t ~ '\m(TED|TRANSFER[ÊE]NCIA\s*BANC[ÁA]RIA|TRANSFER[ÊE]NCIA\s*ELETR[ÔO]NICA|TRANSFER[ÊE]NCIA)\M' THEN RETURN 'transferencia'; END IF;
  IF t ~ '\mCHEQUE\M' THEN RETURN 'cheque'; END IF;
  IF t ~ '\m(DINHEIRO|ESP[ÉE]CIE)\M' THEN RETURN 'dinheiro'; END IF;
  IF t ~ '\mCART[ÃA]O\s*(DE\s*)?CR[ÉE]DITO\M' THEN RETURN 'cartao_credito'; END IF;
  IF t ~ '\mCART[ÃA]O\s*(DE\s*)?D[ÉE]BITO\M' THEN RETURN 'cartao_debito'; END IF;
  IF t ~ '\m(FATURADO|FATURA\s*MENSAL)\M' THEN RETURN 'faturado'; END IF;
  IF t ~ '\m(A\s*PRAZO|APRAZO)\M' THEN RETURN 'a_prazo'; END IF;
  IF t ~ '\m(A\s*VISTA|[ÀA]\s*VISTA|AVISTA)\M' THEN RETURN 'a_vista'; END IF;
  RETURN NULL;
END;
$$;

-- Backfill: aplica detecção em todas as fiscal_documents que ainda não têm payment_method
UPDATE public.fiscal_documents fd
SET delivery_meta = COALESCE(fd.delivery_meta, '{}'::jsonb)
                    || jsonb_build_object('payment_method', detected.pm)
FROM (
  SELECT
    id,
    public.detect_payment_method(
      COALESCE(
        client_load_source->>'observationSnippet',
        client_load_source->>'infCpl',
        client_load_source->>'observation'
      )
    ) AS pm
  FROM public.fiscal_documents
  WHERE (delivery_meta->>'payment_method') IS NULL
     OR (delivery_meta->>'payment_method') = ''
) detected
WHERE fd.id = detected.id
  AND detected.pm IS NOT NULL;

-- linter:allow-no-tenant legacy-migration 2026-12-31
