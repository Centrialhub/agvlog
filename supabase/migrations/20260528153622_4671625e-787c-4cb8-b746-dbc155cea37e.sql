
-- Backfill payment_method em delivery_meta a partir da observação da NF
WITH detected AS (
  SELECT
    id,
    upper(coalesce(client_load_source->>'observationSnippet','')) AS obs
  FROM public.fiscal_documents
  WHERE document_type='inbound'
    AND NOT (coalesce(delivery_meta,'{}'::jsonb) ? 'payment_method')
    AND coalesce(client_load_source->>'observationSnippet','') <> ''
),
mapped AS (
  SELECT id,
    CASE
      WHEN obs ~ '\mPIX\M' THEN 'pix'
      WHEN obs ~ '\m(BOLETO|BOL\.?|BC|BB|COBRAN[ÇC]A\s*BANC[ÁA]RIA|DUPLICATA|DUP\.?)\M' THEN 'boleto'
      WHEN obs ~ '\m(TED|DOC|TRANSFER[ÊE]NCIA|TRANSF\.?)\M' THEN 'transferencia'
      WHEN obs ~ '\m(CHEQUE|CH)\M' THEN 'cheque'
      WHEN obs ~ '\m(DINHEIRO|ESP[ÉE]CIE|DIN)\M' THEN 'dinheiro'
      WHEN obs ~ '\m(CART[ÃA]O\s*(DE\s*)?CR[ÉE]DITO|CC)\M' THEN 'cartao_credito'
      WHEN obs ~ '\m(CART[ÃA]O\s*(DE\s*)?D[ÉE]BITO|CD)\M' THEN 'cartao_debito'
      WHEN obs ~ '\m(FATURADO|FATURA|FAT\.?)\M' THEN 'faturado'
      WHEN obs ~ '\m(A\s*PRAZO|PRAZO|APRAZ)\M' THEN 'a_prazo'
      WHEN obs ~ '\m(A\s*VISTA|[ÀA]\s*VISTA|AVISTA)\M' THEN 'a_vista'
      ELSE NULL
    END AS pm
  FROM detected
)
UPDATE public.fiscal_documents fd
SET delivery_meta = coalesce(fd.delivery_meta,'{}'::jsonb) || jsonb_build_object('payment_method', m.pm)
FROM mapped m
WHERE fd.id = m.id AND m.pm IS NOT NULL;
