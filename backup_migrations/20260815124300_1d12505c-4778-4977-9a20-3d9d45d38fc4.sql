ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS is_duplicate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_note text;

WITH a AS (
  SELECT id, access_key, created_at,
         jsonb_array_elements(cte_payload->'payload'->'notasFiscais') AS nf
  FROM public.fiscal_documents
  WHERE deleted_at IS NULL AND cte_payload IS NOT NULL AND sefaz_status = 'authorized'
), b AS (
  SELECT id, access_key, created_at,
         COALESCE(nf->>'chave', nf->>'chaveAcesso', nf->>'chNFe') AS nfkey
  FROM a
), dups AS (
  SELECT id, nfkey,
         row_number() OVER (PARTITION BY nfkey ORDER BY created_at) AS rn
  FROM b
  WHERE nfkey IS NOT NULL
)
UPDATE public.fiscal_documents f
   SET is_duplicate = true,
       duplicate_note = 'CT-e duplicado da NF-e ' || d.nfkey || ' (oculto do lote, nao cancelado na SEFAZ)',
       updated_at = now()
  FROM dups d
 WHERE f.id = d.id AND d.rn > 1;
-- linter:allow-no-tenant legacy-migration 2026-12-31
