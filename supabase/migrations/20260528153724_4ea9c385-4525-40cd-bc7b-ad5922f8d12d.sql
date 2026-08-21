
-- 1) Limpa payment_method indevidamente preenchido pelo backfill anterior
UPDATE public.fiscal_documents
SET delivery_meta = delivery_meta - 'payment_method'
WHERE document_type='inbound'
  AND delivery_meta ? 'payment_method';

-- 2) Re-aplica detecção com regras conservadoras (palavras inteiras, sem abreviações ambíguas)
WITH detected AS (
  SELECT
    id,
    upper(coalesce(client_load_source->>'observationSnippet','')) AS obs
  FROM public.fiscal_documents
  WHERE document_type='inbound'
    AND coalesce(client_load_source->>'observationSnippet','') <> ''
),
mapped AS (
  SELECT id,
    CASE
      WHEN obs ~ '\mPIX\M' THEN 'pix'
      WHEN obs ~ '\m(BOLETO|COBRAN[ÇC]A\s*BANC[ÁA]RIA|DUPLICATA)\M' THEN 'boleto'
      WHEN obs ~ '\m(TED|TRANSFER[ÊE]NCIA\s*BANC[ÁA]RIA|TRANSFER[ÊE]NCIA\s*ELETR[ÔO]NICA)\M' THEN 'transferencia'
      WHEN obs ~ '\mCHEQUE\M' THEN 'cheque'
      WHEN obs ~ '\m(DINHEIRO|ESP[ÉE]CIE)\M' THEN 'dinheiro'
      WHEN obs ~ '\mCART[ÃA]O\s*(DE\s*)?CR[ÉE]DITO\M' THEN 'cartao_credito'
      WHEN obs ~ '\mCART[ÃA]O\s*(DE\s*)?D[ÉE]BITO\M' THEN 'cartao_debito'
      WHEN obs ~ '\m(FATURADO|FATURA\s*MENSAL)\M' THEN 'faturado'
      WHEN obs ~ '\m(A\s*PRAZO|APRAZO)\M' THEN 'a_prazo'
      WHEN obs ~ '\m(A\s*VISTA|[ÀA]\s*VISTA|AVISTA)\M' THEN 'a_vista'
      ELSE NULL
    END AS pm
  FROM detected
)
UPDATE public.fiscal_documents fd
SET delivery_meta = coalesce(fd.delivery_meta,'{}'::jsonb) || jsonb_build_object('payment_method', m.pm)
FROM mapped m
WHERE fd.id = m.id AND m.pm IS NOT NULL;
