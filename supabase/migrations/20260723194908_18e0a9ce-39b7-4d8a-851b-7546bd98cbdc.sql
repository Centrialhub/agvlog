
-- 1) Flags de tipo em clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_client boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_supplier boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_clients_tenant_supplier
  ON public.clients(tenant_id) WHERE is_supplier = true;
CREATE INDEX IF NOT EXISTS idx_clients_tenant_client
  ON public.clients(tenant_id) WHERE is_client = true;

-- 2) supplier_id em fiscal_documents
ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_supplier
  ON public.fiscal_documents(supplier_id) WHERE supplier_id IS NOT NULL;

-- 3) Marca fornecedores existentes cujo CNPJ apareça como remetente em notas
UPDATE public.clients c
   SET is_supplier = true
  FROM (
    SELECT DISTINCT tenant_id, regexp_replace(coalesce(remitter_cnpj,''),'\D','','g') AS cnpj
      FROM public.fiscal_documents
     WHERE remitter_cnpj IS NOT NULL
  ) fd
 WHERE fd.tenant_id = c.tenant_id
   AND length(fd.cnpj) > 0
   AND regexp_replace(coalesce(c.tax_id,''),'\D','','g') = fd.cnpj
   AND c.is_supplier = false;

-- 4) Backfill de supplier_id nas notas existentes
UPDATE public.fiscal_documents fd
   SET supplier_id = c.id
  FROM public.clients c
 WHERE fd.tenant_id = c.tenant_id
   AND fd.supplier_id IS NULL
   AND fd.remitter_cnpj IS NOT NULL
   AND regexp_replace(coalesce(fd.remitter_cnpj,''),'\D','','g') =
       regexp_replace(coalesce(c.tax_id,''),'\D','','g')
   AND length(regexp_replace(coalesce(fd.remitter_cnpj,''),'\D','','g')) > 0;

-- 5) Trigger de auto-link do fornecedor pelo CNPJ do remetente
CREATE OR REPLACE FUNCTION public.trg_fiscal_documents_autolink_supplier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cnpj text;
BEGIN
  IF NEW.supplier_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_cnpj := regexp_replace(coalesce(NEW.remitter_cnpj,''),'\D','','g');
  IF length(v_cnpj) = 0 THEN
    RETURN NEW;
  END IF;
  SELECT id INTO NEW.supplier_id
    FROM public.clients
   WHERE tenant_id = NEW.tenant_id
     AND regexp_replace(coalesce(tax_id,''),'\D','','g') = v_cnpj
   ORDER BY is_supplier DESC, active DESC, created_at ASC
   LIMIT 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fiscal_documents_autolink_supplier ON public.fiscal_documents;
CREATE TRIGGER trg_fiscal_documents_autolink_supplier
  BEFORE INSERT OR UPDATE OF remitter_cnpj, supplier_id
  ON public.fiscal_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fiscal_documents_autolink_supplier();
